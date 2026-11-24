// Telegram-бот: погода в Алматы и курсы валют.
// Работает через long polling: бот сам спрашивает у Telegram «есть новые сообщения?».

// ---------- Токен из файла .env ----------
try {
  process.loadEnvFile(); // читает .env и кладёт значения в process.env
} catch {
  // файла .env нет — возможно, токен задан переменной окружения
}

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error("Не найден BOT_TOKEN. Создай файл .env по образцу .env.example");
  process.exit(1);
}
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;

// ---------- Типы ----------
interface Weather {
  current: {
    time: string;
    temperature_2m: number;
    wind_speed_10m: number;
  };
}

interface Currency {
  date: string;
  base: string;
  quote: string;
  rate: number;
}

interface CrossRate {
  usdKzt: Currency;
  tryKzt: Currency;
  cross: number; // сколько лир в 1 долларе
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number };
    text?: string;
  };
}

interface TelegramResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

// ---------- Данные: погода и курсы ----------
async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Ошибка запроса: ${response.status}`);
  }
  return (await response.json()) as T;
}

function getWeather(): Promise<Weather> {
  return getJson<Weather>(
    "https://api.open-meteo.com/v1/forecast?latitude=43.24&longitude=76.89&current=temperature_2m,wind_speed_10m",
  );
}

function getCurrency(base: string, quote: string): Promise<Currency> {
  return getJson<Currency>(`https://api.frankfurter.dev/v2/rate/${base}/${quote}`);
}

// Кросс-курс USD → TRY через KZT. Нужны оба курса, поэтому Promise.all.
async function getCrossRate(): Promise<CrossRate> {
  const [usdKzt, tryKzt] = await Promise.all([
    getCurrency("USD", "KZT"),
    getCurrency("TRY", "KZT"),
  ]);
  return { usdKzt, tryKzt, cross: usdKzt.rate / tryKzt.rate };
}

// ---------- Тексты ответов ----------
async function weatherText(): Promise<string> {
  const weather = await getWeather();
  return (
    `🌤 В Алматы сейчас ${weather.current.temperature_2m} °C\n` +
    `💨 Ветер ${weather.current.wind_speed_10m} км/ч`
  );
}

async function ratesText(): Promise<string> {
  const { usdKzt, tryKzt, cross } = await getCrossRate();
  return (
    `💵 1 ${usdKzt.base} = ${usdKzt.rate} ${usdKzt.quote}\n` +
    `🇹🇷 1 ${tryKzt.base} = ${tryKzt.rate} ${tryKzt.quote}\n` +
    `🔁 Кросс-курс через KZT: 1 USD = ${cross.toFixed(4)} TRY`
  );
}

// Погода и курсы вместе. allSettled: если одно не пришло, второе всё равно покажем.
async function allText(): Promise<string> {
  const [weather, rates] = await Promise.allSettled([weatherText(), ratesText()]);
  const parts = [
    weather.status === "fulfilled" ? weather.value : "⚠️ Не удалось получить погоду",
    rates.status === "fulfilled" ? rates.value : "⚠️ Не удалось получить курсы",
  ];
  return parts.join("\n\n");
}

const HELP_TEXT =
  "Привет! Я умею:\n" +
  "/weather — погода в Алматы\n" +
  "/rates — курсы доллара и лиры к тенге и кросс-курс\n" +
  "/all — всё сразу\n" +
  "/promises — примеры работы с Promise";

// ---------- Telegram API ----------
async function telegram<T>(method: string, body: object): Promise<T> {
  const response = await fetch(`${TELEGRAM_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as TelegramResponse<T>;
  if (!data.ok) {
    throw new Error(`Telegram (${method}): ${data.description}`);
  }
  return data.result;
}

function sendMessage(chatId: number, text: string): Promise<unknown> {
  return telegram("sendMessage", { chat_id: chatId, text });
}

// ---------- Примеры Promise ----------
// Каждая функция возвращает готовый текст для ответа в Telegram.

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Promise, который сам проваливается через ms миллисекунд (нужен для race)
function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`таймаут ${ms} мс`)), ms);
  });
}

// 1. new Promise — сами решаем, когда вызвать resolve (успех) или reject (ошибка)
async function demoNewPromise(): Promise<string> {
  const wait = new Promise<string>((resolve) => {
    setTimeout(() => resolve("прошла 1 секунда"), 1000);
  });
  const ok = await wait;

  let failed: string;
  try {
    await new Promise<string>((_, reject) => reject(new Error("так и задумано")));
    failed = "не сработало";
  } catch (error) {
    failed = errorMessage(error);
  }
  return (
    "🆕 new Promise\n" +
    `✅ resolve → ${ok}\n` +
    `❌ reject → ${failed}`
  );
}

// 2. Promise.resolve / Promise.reject — готовые уже завершённые Promise
async function demoStatic(): Promise<string> {
  const value = await Promise.resolve(42);

  let failed: string;
  try {
    await Promise.reject(new Error("отказ"));
    failed = "не сработало";
  } catch (error) {
    failed = errorMessage(error);
  }
  return (
    "📦 Promise.resolve / Promise.reject\n" +
    `✅ Promise.resolve(42) → ${value}\n` +
    `❌ Promise.reject(...) → ${failed}`
  );
}

// 3. .then / .catch / .finally — цепочка вместо await
function demoThen(): Promise<string> {
  return getCurrency("USD", "KZT")
    .then((currency) => `1 USD = ${currency.rate} KZT`) // успех
    .catch((error) => `ошибка: ${errorMessage(error)}`) // ошибка в любом звене цепочки
    .finally(() => console.log("finally: сработает в любом случае")) // выполнится всегда
    .then((line) => `🔗 then / catch / finally\n${line}`);
}

// 4. async/await + try/catch/finally — то же самое, но читается как обычный код
async function demoAwait(): Promise<string> {
  const lines: string[] = [];

  try {
    const good = await getCurrency("USD", "KZT");
    lines.push(`✅ верный запрос → 1 USD = ${good.rate} KZT`);
    await getCurrency("USD", "XXX"); // такой валюты нет, сервер вернёт ошибку
    lines.push("до сюда не дойдём");
  } catch (error) {
    lines.push(`❌ неверный запрос → ${errorMessage(error)}`);
  } finally {
    lines.push("🏁 finally выполнился");
  }
  return "⏳ async/await + try/catch/finally\n" + lines.join("\n");
}

// 5. Последовательно и параллельно: сравниваем время
async function demoTiming(): Promise<string> {
  let start = Date.now();
  await getWeather();
  await getCurrency("USD", "KZT");
  const sequential = Date.now() - start;

  start = Date.now();
  await Promise.all([getWeather(), getCurrency("USD", "KZT")]);
  const parallel = Date.now() - start;

  return (
    "⏱ Последовательно и параллельно\n" +
    `await один за другим: ${sequential} мс\n` +
    `Promise.all вместе: ${parallel} мс`
  );
}

// 6. Promise.all — ждёт ВСЕ; если упал хотя бы один, падает целиком
async function demoPromiseAll(): Promise<string> {
  const [weather, currency] = await Promise.all([getWeather(), getCurrency("USD", "KZT")]);
  const lines = [
    `✅ все удались → ${weather.current.temperature_2m} °C, 1 USD = ${currency.rate} KZT`,
  ];

  try {
    await Promise.all([getCurrency("USD", "KZT"), getCurrency("USD", "XXX")]);
  } catch (error) {
    lines.push(`❌ один упал → упало всё: ${errorMessage(error)}`);
  }
  return "🤝 Promise.all\n" + lines.join("\n");
}

// 7. Promise.allSettled — ждёт все и сообщает итог по каждому, ничего не роняет
async function demoAllSettled(): Promise<string> {
  const results = await Promise.allSettled([
    getCurrency("USD", "KZT"),
    getCurrency("USD", "XXX"), // этот упадёт
    getCurrency("USD", "TRY"),
  ]);

  const lines = results.map((result, i) =>
    result.status === "fulfilled"
      ? `#${i + 1} fulfilled → 1 USD = ${result.value.rate} ${result.value.quote}`
      : `#${i + 1} rejected → ${errorMessage(result.reason)}`,
  );
  return "🧾 Promise.allSettled\n" + lines.join("\n");
}

// 8. Promise.race — результат того, кто завершился первым (успех или ошибка)
async function demoRace(): Promise<string> {
  const lines: string[] = [];

  try {
    const weather = await Promise.race([getWeather(), timeout(5000)]);
    lines.push(`✅ запрос успел за 5 с → ${weather.current.temperature_2m} °C`);
  } catch (error) {
    lines.push(`❌ ${errorMessage(error)}`);
  }

  try {
    await Promise.race([getWeather(), timeout(1)]);
    lines.push("запрос успел за 1 мс (маловероятно)");
  } catch (error) {
    lines.push(`⏰ запрос не успел за 1 мс → ${errorMessage(error)}`);
  }
  return "🏁 Promise.race (запрос против таймера)\n" + lines.join("\n");
}

// 9. Promise.any — первый УСПЕШНЫЙ; ошибки игнорирует, пока есть надежда
async function demoAny(): Promise<string> {
  const lines: string[] = [];

  const first = await Promise.any([
    getCurrency("USD", "XXX"), // упадёт — игнорируем
    getCurrency("USD", "KZT"), // удастся
  ]);
  lines.push(`✅ один упал, второй удался → 1 USD = ${first.rate} ${first.quote}`);

  try {
    await Promise.any([getCurrency("USD", "XXX"), getCurrency("USD", "YYY")]);
  } catch (error) {
    if (error instanceof AggregateError) {
      lines.push(`❌ упали все (${error.errors.length} шт.) → AggregateError`);
    } else {
      lines.push(`❌ ${errorMessage(error)}`);
    }
  }
  return "🥇 Promise.any\n" + lines.join("\n");
}

const PROMISE_DEMOS: Record<string, () => Promise<string>> = {
  "/new": demoNewPromise,
  "/static": demoStatic,
  "/then": demoThen,
  "/await": demoAwait,
  "/timing": demoTiming,
  "/pall": demoPromiseAll,
  "/settled": demoAllSettled,
  "/race": demoRace,
  "/any": demoAny,
};

const PROMISES_TEXT =
  "Примеры Promise:\n" +
  "/new — new Promise: resolve и reject\n" +
  "/static — Promise.resolve и Promise.reject\n" +
  "/then — цепочка then / catch / finally\n" +
  "/await — async/await и try/catch/finally\n" +
  "/timing — последовательно и параллельно (время)\n" +
  "/pall — Promise.all\n" +
  "/settled — Promise.allSettled\n" +
  "/race — Promise.race (таймаут)\n" +
  "/any — Promise.any";

// ---------- Обработка команд ----------
async function handleMessage(chatId: number, text: string): Promise<void> {
  // "/weather@my_bot лишний текст" -> "/weather"
  const command = (text.split(" ")[0] ?? "").split("@")[0] ?? "";

  try {
    const demo = PROMISE_DEMOS[command];
    if (demo) {
      await sendMessage(chatId, await demo());
      return;
    }

    switch (command) {
      case "/start":
      case "/help":
        await sendMessage(chatId, HELP_TEXT);
        break;
      case "/weather":
        await sendMessage(chatId, await weatherText());
        break;
      case "/rates":
        await sendMessage(chatId, await ratesText());
        break;
      case "/all":
        await sendMessage(chatId, await allText());
        break;
      case "/promises":
        await sendMessage(chatId, PROMISES_TEXT);
        break;
      default:
        await sendMessage(chatId, "Не знаю такую команду. Напиши /help");
    }
  } catch (error) {
    console.error("Ошибка команды", command, error instanceof Error ? error.message : error);
    await sendMessage(chatId, "⚠️ Что-то пошло не так, попробуй ещё раз позже");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Главный цикл ----------
async function main(): Promise<void> {
  const me = await telegram<{ username: string }>("getMe", {});
  console.log(`Бот запущен: @${me.username}. Остановить: Ctrl+C`);

  let offset = 0; // с какого update_id просим новые сообщения

  while (true) {
    try {
      // timeout: 30 — Telegram держит запрос открытым до 30 секунд, пока нет новых сообщений
      const updates = await telegram<TelegramUpdate[]>("getUpdates", { offset, timeout: 30 });

      for (const update of updates) {
        offset = update.update_id + 1; // подтверждаем, что это сообщение обработано
        const message = update.message;
        if (message?.text) {
          await handleMessage(message.chat.id, message.text);
        }
      }
    } catch (error) {
      console.error("Ошибка:", error instanceof Error ? error.message : error);
      await sleep(3000); // небольшая пауза перед повтором
    }
  }
}

main().catch((error) => {
  console.error("Бот не запустился:", error instanceof Error ? error.message : error);
  process.exit(1);
});
