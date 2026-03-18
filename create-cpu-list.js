// Fetches Geekbench CPU data, enriches it with thread counts and boost frequencies, and exports the results to JSON.
async function fetchCpuData(delayMs = 1400) {
    let currentDelay = delayMs;
    // Fetch processor list and check for HTTP 429 (Too Many Requests)
    let listResp = await fetch("https://browser.geekbench.com/processor-benchmarks.json");
    if (listResp.status === 429) {
        const retryAfter = listResp.headers.get('Retry-After');
        let waitTime = retryAfter ? (Number.parseInt(retryAfter, 10) * 1000) : (currentDelay * 2);
        console.warn(`Received 429 Too Many Requests when fetching processor list. Retrying after ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        listResp = await fetch("https://browser.geekbench.com/processor-benchmarks.json");
    }
    if (!listResp.ok) {
        throw new Error(`Failed to fetch processor list: ${listResp.status} ${listResp.statusText}`);
    }
    const processorList = (await listResp.json()).devices
    console.log(`Fetched${processorList.length} processors. Fetching threads for each processor...`);

    let totalIterationTimeMs = 0;
    let iterationCount = 0;

    console.log("Estimated time: " + (processorList.length * 1000 / 60).toFixed(2) + " minutes");
    const processorListWithThreads =[]
    for (let i = 0; i < processorList.length; i++) {
        const iterationStart = Date.now();
        const {description, ...processor} = processorList[i];
        processor.name = processor.name.trim()
        if (processor.name === "AMD Ryzen Threadripper PRO 9985WX s") {
            // There's a typo in the original dataset
            processor.name = "AMD Ryzen Threadripper PRO 9985WX"
        }
        const coreCount = description.match(/\((\d+) cores?\)/);
        const frequency = parseFrequencyGHz(description);
        const detailsUrls = buildProcessorDetailsUrls(processor.name);
        console.log(`fetching threads and boost frequency for ${processor.name} at ${detailsUrls[0]}`);
        let processorSpecs;
        let originalError;
        for (let urlIndex = 0; urlIndex < detailsUrls.length; urlIndex++) {
            const candidateUrl = detailsUrls[urlIndex];
            if (urlIndex > 0) {
                console.log(`Retrying ${processor.name} at ${candidateUrl}`);
            }
            try {
                // Modified to pass the current delay and a way to update it if needed
                processorSpecs = await fetchProcessorSpecsWithRetry(candidateUrl, frequency, currentDelay);
                // If we succeeded and have a new delay recommended, we could update it,
                // but usually we just want to handle the 429 inside the fetcher.
                break;
            } catch (error) {
                if (error.message.includes('Too Many Requests')) {
                    // If even after internal retry it fails with 429, we double the global delay for the rest of the run
                    currentDelay *= 2;
                    console.log(`Persistent 429. Increasing base delay to ${currentDelay}ms`);
                }
                if (!originalError) {
                    originalError = error;
                }
            }
        }
        if (!processorSpecs) {
            throw originalError;
        }
        const { threads, boostFrequency } = processorSpecs;

        // sleep between requests to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, currentDelay));

        const iterationEnd = Date.now();
        const lastIterationTime = iterationEnd - iterationStart;
        totalIterationTimeMs += lastIterationTime;
        iterationCount++;

        const avgIterationTimeMs = totalIterationTimeMs / iterationCount;
        const remainingProcessors = processorList.length - i - 1;
        const estimatedTimeRemainingMin = (remainingProcessors * avgIterationTimeMs / 1000 / 60).toFixed(2);

        console.log(`${i + 1}/${processorList.length}: ${processor.name} - ${threads} threads. Estimated time remaining: ${estimatedTimeRemainingMin} minutes (avg ${ (avgIterationTimeMs / 1000).toFixed(2) }s/cpu)`);

        processorListWithThreads.push({
            ...processor,
            frequency,
            boost_frequency: boostFrequency,
            cores: parseInt(coreCount[1], 10),
            threads
        });
    }
    // Export CPU list to JSON after scraping completes
    await exportCpuListToJson(processorListWithThreads, 'cpu-list.json');
}

function buildProcessorDetailsUrls(name) {
    const urls = [
        buildProcessorDetailsUrl(name),
        buildProcessorDetailsUrl(name, { singularizeTrailingS: true }),
        buildProcessorDetailsUrl(name, { withRadeonGraphics: true }),
        buildProcessorDetailsUrl(name, { withRadeonGraphics: true, singularizeTrailingS: true })
    ];
    return [...new Set(urls)];
}

function buildProcessorDetailsUrl(name, { withRadeonGraphics = false, singularizeTrailingS = false } = {}) {
    let slug = name
        .replace(/\+/g, '')
        .replace(/\//g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .toLowerCase();
    if (withRadeonGraphics && !slug.endsWith('-with-radeon-graphics')) {
        slug += '-with-radeon-graphics';
    }
    if (singularizeTrailingS && slug.endsWith('-s')) {
        slug = slug.slice(0, -2);
    }
    return `https://browser.geekbench.com/processors/${slug}`;
}

async function fetchProcessorSpecsWithRetry(detailsUrl, baseFrequency, currentDelay) {
    let resp = await fetch(detailsUrl);
    if (resp.status === 429) {
        const retryAfter = resp.headers.get('Retry-After');
        let waitTime = retryAfter ? (Number.parseInt(retryAfter, 10) * 1000) : (currentDelay * 2);
        console.warn(`Received 429 Too Many Requests when fetching ${detailsUrl}. Waiting ${waitTime}ms before retrying once...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        resp = await fetch(detailsUrl);
    }

    if (resp.status === 429) {
        throw new Error('Too Many Requests');
    }
    if (!resp.ok) {
        throw new Error(`Failed to fetch details from ${detailsUrl}: ${resp.status} ${resp.statusText}`);
    }
    const scrapedHTML = await resp.text();
    return {
        threads: extractThreadsFromHtml(scrapedHTML),
        boostFrequency: extractBoostFrequencyFromHtml(scrapedHTML, baseFrequency)
    };
}

function parseFrequencyGHz(description) {
    // Might be both in GHz or MHz, handles both cases, converts MHz to GHz if needed
    const frequencyMatch = description.match(/([\d.]+)\s*([GM])Hz/i);
    if (!frequencyMatch) {
        throw new Error(`Frequency not found in description: ${description}`);
    }
    const value = parseFloat(frequencyMatch[1]);
    const unit = frequencyMatch[2].toUpperCase();
    return unit === 'M' ? value / 1000 : value;
}

async function exportCpuListToJson(cpuList, filename = 'cpu-list.json') {
    const json = JSON.stringify(cpuList, null, 2);

    try {
        const fs = require('fs').promises;
        await fs.writeFile(filename, json, 'utf8');
        console.log(`JSON written to ${filename}`);
    } catch (err) {
        console.error('Failed to write JSON file:', err);
        throw err;
    }

    return json;
}

function extractThreadsFromHtml(html) {
    const rawThreads = extractSystemValueFromHtml(html, 'Threads');
    if (rawThreads) {
        const num = /([0-9][0-9,]*)/.exec(rawThreads);
        return num ? parseInt(num[1].replace(/,/g, ''), 10) : null;
    }
    throw new Error("Threads not found in HTML" + html);
}

function extractBoostFrequencyFromHtml(html, baseFrequency) {
    const rawBoostFrequency = extractSystemValueFromHtml(html, 'Maximum Frequency');
    return rawBoostFrequency ? parseFrequencyGHz(rawBoostFrequency) : baseFrequency;
}

function extractSystemValueFromHtml(html, label) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`<td[^>]*class=["']system-name["'][^>]*>\\s*${escapedLabel}\\s*<\\/td>\\s*<td[^>]*class=["']system-value["'][^>]*>\\s*([^<]+?)\\s*<\\/td>`, 'i');
    const match = pattern.exec(html);
    return match?.[1]?.trim() ?? null;
}

function parseDelayMsArg(argv) {
    const rawDelay = argv[2];
    if (rawDelay === undefined) {
        return 1400;
    }

    if (!/^\d+$/.test(rawDelay)) {
        throw new Error(`Invalid sleep delay: ${rawDelay}. Provide a non-negative integer in milliseconds.`);
    }

    return Number.parseInt(rawDelay, 10);
}

const delayMs = parseDelayMsArg(process.argv);
fetchCpuData(delayMs).catch(err => {
    console.error("Error fetching CPU data:", err);
    process.exitCode = 1;
});
