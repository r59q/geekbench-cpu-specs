# Geekbench CPU Specs

> [!WARNING]
> This project will no longer work as of april 24th 2026, as GeekBench has blocked access via webscraping. I will keep up the repository for archival purposes but the CPU list will not be updated anymore.

List of all CPUs in Geekbench with their specs. See [cpu-list.v1.json](cpu-list.v1.json) for the actual data.
Updated once per day automatically.

 To generate it, a simple, no-dependency node script which fetches all CPUs at [geekbench](https://browser.geekbench.com/processor-benchmarks.json)
 and refines the results, adding boost frequency, number of threads, performance/efficiency cores, gpu and tdp by regex webscraping their own cpu index site.

## Output Overview
The output and types of the fields are as follows in the table
| Field | Type | Description |
|---|---|---|
| id | number | Geekbench CPU ID |
| name | string | CPU name |
| samples | number | Number of samples submitted to Geekbench |
| score | number | Single-core score |
| multicore_score | number | Multi-core score |
| icon | string | Icon name for the CPU brand (e.g. "amd", "intel") |
| family | string | CPU family name |
| frequency | number | Base frequency in GHz |
| boost_frequency | number | Boost frequency in GHz |
| cores | number | Number of CPU cores |
| performance_cores | number or null | Number of performance cores (if applicable) |
| efficiency_cores | number or null | Number of efficiency cores (if applicable) |
| threads | number | Number of CPU threads |
| package | string or null | CPU package type (e.g. "Socket FP8") |
| tdp | number or null | Thermal Design Power in watts |
| gpu | string or null | Integrated GPU name if present (e.g. "Radeon 740M Graphics") |

## Testing it quickly

Using node through terminal
```shell
echo 'fetch("https://raw.githubusercontent.com/r59q/geekbench-cpu-specs/refs/heads/master/cpu-list.v1.json")
  .then(res => res.json())
  .then(data => {
    console.log(data["Intel Core i7-6700"]);
  });' | node -
```
Using curl and jq
```shell
curl -fsSL "https://raw.githubusercontent.com/r59q/geekbench-cpu-specs/refs/heads/master/cpu-list.v1.json" | jq -r '."Intel Core i7-6700"'
```
Using javascript
```javascript
fetch("https://raw.githubusercontent.com/r59q/geekbench-cpu-specs/refs/heads/master/cpu-list.v1.json")
  .then(res => res.json())
  .then(data => {
    console.log(data["Intel Core i7-6700"]);
  });
```

## Creating the cpu-list file locally
Running it only requires NodeJS
```shell
node create-cpu-list.js
```
This will generate a file cpu-list.v1.json. This process will take around 45 minutes to 1 hour depending on rate limits exponential back-off is implemented to not trigger rate-limit.

You can also specify a filename
```shell
node create-cpu-list.js geekbench-cpu-list.json
```

If you already have a cpu-list.v1.json file, it will be used as a cache to avoid re-fetching data for CPUs that haven't changed. The script will only fetch data for new CPUs or those that have updated scores.

You can also just download the cpu-list.v1.json file from this repository. It will be the same file you can generate running it yourself. It is updated once per day automatically.

Example output:
```json

{
  "AMD Ryzen Threadripper PRO 9965WX": {
    "id": 4184,
    "name": "AMD Ryzen Threadripper PRO 9965WX",
    "samples": 31,
    "score": 3042,
    "multicore_score": 25847,
    "icon": "amd",
    "family": "Shimada Peak",
    "frequency": 4.2,
    "boost_frequency": 5.4,
    "cores": 24,
    "performance_cores": null,
    "efficiency_cores": null,
    "threads": 48,
    "package": null,
    "tdp": 350,
    "gpu": null
  },
  "AMD Ryzen 5 220": {
    "id": 4190,
    "name": "AMD Ryzen 5 220",
    "samples": 235,
    "score": 2163,
    "multicore_score": 7203,
    "icon": "amd",
    "family": "Hawk Point",
    "frequency": 3.2,
    "boost_frequency": 4.9,
    "cores": 6,
    "performance_cores": null,
    "efficiency_cores": null,
    "threads": 12,
    "package": "Socket FP8",
    "tdp": 28,
    "gpu": "Radeon 740M Graphics"
  }
}
```

For any questions, suggestions or issues please open an issue in the repository. I'll be happy to add anything I've missed and feel free to open a PR if you want to contribute with improvements or fixes.