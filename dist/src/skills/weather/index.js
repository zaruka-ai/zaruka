const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';
export class WeatherSkill {
    name = 'weather';
    description = 'Weather and marine conditions via Open-Meteo API';
    tools = [
        {
            name: 'get_weather',
            description: 'Get weather forecast for a location',
            parameters: {
                type: 'object',
                properties: {
                    location: { type: 'string', description: 'City or place name' },
                    date: { type: 'string', description: 'Date in YYYY-MM-DD format (optional, default: today)' },
                },
                required: ['location'],
            },
        },
        {
            name: 'get_marine_conditions',
            description: 'Get marine/ocean conditions (wave height, period, direction) for a coastal location',
            parameters: {
                type: 'object',
                properties: {
                    location: { type: 'string', description: 'Coastal city or place name' },
                    date: { type: 'string', description: 'Date in YYYY-MM-DD format (optional, default: today)' },
                },
                required: ['location'],
            },
        },
    ];
    async geocode(location) {
        const url = `${GEOCODING_URL}?name=${encodeURIComponent(location)}&count=1&language=en`;
        const res = await fetch(url);
        const data = await res.json();
        return data.results?.[0] ?? null;
    }
    async execute(toolName, params) {
        const location = params.location;
        const geo = await this.geocode(location);
        if (!geo) {
            return JSON.stringify({ error: `Location "${location}" not found` });
        }
        if (toolName === 'get_weather') {
            return this.getWeather(geo, params.date);
        }
        else if (toolName === 'get_marine_conditions') {
            return this.getMarine(geo, params.date);
        }
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
    async getWeather(geo, date) {
        const params = new URLSearchParams({
            latitude: String(geo.latitude),
            longitude: String(geo.longitude),
            daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,weathercode',
            current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,weathercode',
            timezone: 'auto',
            forecast_days: '7',
        });
        const res = await fetch(`${WEATHER_URL}?${params}`);
        const data = await res.json();
        if (date) {
            const daily = data.daily;
            const idx = daily.time.indexOf(date);
            if (idx >= 0) {
                return JSON.stringify({
                    location: `${geo.name}, ${geo.country}`,
                    date,
                    temperature_max: daily.temperature_2m_max[idx],
                    temperature_min: daily.temperature_2m_min[idx],
                    precipitation_mm: daily.precipitation_sum[idx],
                    wind_speed_max_kmh: daily.wind_speed_10m_max[idx],
                });
            }
        }
        return JSON.stringify({
            location: `${geo.name}, ${geo.country}`,
            current: data.current,
            daily_forecast: data.daily,
        });
    }
    async getMarine(geo, date) {
        const params = new URLSearchParams({
            latitude: String(geo.latitude),
            longitude: String(geo.longitude),
            daily: 'wave_height_max,wave_period_max,wave_direction_dominant',
            timezone: 'auto',
            forecast_days: '7',
        });
        const res = await fetch(`${MARINE_URL}?${params}`);
        const data = await res.json();
        if (date) {
            const daily = data.daily;
            const idx = daily.time.indexOf(date);
            if (idx >= 0) {
                return JSON.stringify({
                    location: `${geo.name}, ${geo.country}`,
                    date,
                    wave_height_max_m: daily.wave_height_max[idx],
                    wave_period_max_s: daily.wave_period_max[idx],
                    wave_direction: daily.wave_direction_dominant[idx],
                });
            }
        }
        return JSON.stringify({
            location: `${geo.name}, ${geo.country}`,
            marine_forecast: data.daily,
        });
    }
}
//# sourceMappingURL=index.js.map