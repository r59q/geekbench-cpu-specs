# Geekbench CPU specs

A simple node script which fetches all CPUs at https://browser.geekbench.com/processor-benchmarks.json
 and refines the results, adding boost frequency and number of threads by webscraping

Running it only requires NodeJS
```shell
node create-cpu-list.js
```
This will generate a file cpu-list.json. This process will take a little less than 1 hour, so as to not trigger rate-limit.

It works by webscraping, you can alter the sleep time in-between scrapes by giving the sleep duration as argument to avoid rate limits.
```shell
# Sleep for 3 seconds in-between network calls
node create-cpu-list.js 3000 # default: 1400
```

Example output:
```json
[
    {
        "id": 4183,
        "name": "AMD Ryzen Threadripper PRO 9955WX",
        "samples": 12,
        "score": 3057,
        "multicore_score": 21825,
        "icon": "amd",
        "family": "Shimada Peak",
        "frequency": 4.5,
        "boost_frequency": 5.4,
        "cores": 16,
        "threads": 32
    },
    {
        "id": 3020,
        "name": "Intel Core i3-N305",
        "samples": 1446,
        "score": 1142,
        "multicore_score": 4193,
        "icon": "intel",
        "family": "Alder Lake-N",
        "frequency": 1.8,
        "boost_frequency": 3.8,
        "cores": 8,
        "threads": 8
    }
]
```
