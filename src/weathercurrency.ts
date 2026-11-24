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

async function getWeather(): Promise<Weather> {
  const url =
    "https://api.open-meteo.com/v1/forecast?latitude=43.24&longitude=76.89&current=temperature_2m,wind_speed_10m";
  const response = await fetch(url);
  // console.log(response);
  const dataWeather = (await response.json()) as Weather;
  // console.log(data);
  return dataWeather;
}

async function getCurrency(base: string, quote: string): Promise<Currency>{
const url = `https://api.frankfurter.dev/v2/rate/${base}/${quote}`;
const response = await fetch(url);
const dataCurrency = (await response.json()) as Currency;
return dataCurrency;
}

interface CrossRate {
  usdKzt: Currency;
  tryKzt: Currency;
  cross: number; // сколько лир в 1 долларе
}

// Кросс-курс USD → TRY через KZT.
// Для расчёта нужны ОБА курса, поэтому здесь Promise.all:
// если не пришёл хотя бы один, посчитать результат нельзя.
async function getCrossRate(): Promise<CrossRate> {
  const [usdKzt, tryKzt] = await Promise.all([
    getCurrency("USD", "KZT"),
    getCurrency("TRY", "KZT"),
  ]);
  return { usdKzt, tryKzt, cross: usdKzt.rate / tryKzt.rate };
}

async function main() {
  console.log("получаем погоду...");
  const [weatherResult, ratesResult] = await Promise.allSettled([
    getWeather(),
    getCrossRate(),
  ]);
  console.log("запросы завершены");

  console.log(await getWeather());
  console.log(await getCurrency("USD", "KZT"));

  if (weatherResult.status === "fulfilled") {
    const weather = weatherResult.value;
    // console.log(weather);
    console.log(`В Алматы сейчас ${weather.current.temperature_2m} °C`);
    console.log(`Ветер ${weather.current.wind_speed_10m} км/ч`);
  } else {
    console.log("Не удалось получить погоду:", weatherResult.reason);
  }

  if (ratesResult.status === "fulfilled") {
    const { usdKzt, tryKzt, cross } = ratesResult.value;
    console.log(`Курс валюты: 1 ${usdKzt.base} = ${usdKzt.rate} ${usdKzt.quote}`);
    console.log(`Курс лиры: 1 ${tryKzt.base} = ${tryKzt.rate} ${tryKzt.quote}`);
    console.log(`Кросс-курс через KZT: 1 USD = ${cross.toFixed(4)} TRY`);
  } else {
    console.log("Не удалось получить курсы:", ratesResult.reason);
  }
}
console.log("start");  
main();
console.log( "end");