const GEEKBENCH_PROCESSOR_BENCHMARKS_URL = "https://browser.geekbench.com/processor-benchmarks.json";
const VERSION_NO = "1";
// Delay will increase each time we hit a 429 (exponential back-off)
let fetchDelay = 50;

main().catch(err => {
    console.error("Error fetching CPU data:", err);
    process.exitCode = 1;
});

/**
 * Fetches list of geekbench processors. Enriching the results by scraping each processor's details page to get thread count and boost frequency, which are not included in the initial JSON response. Exports the enriched list to a JSON file.
 */
async function main() {
    let totalIterationTimeMs = 0;
    let iterationCount = 0;
    const benchmarks = (await (await retryingFetchWithBackoff(GEEKBENCH_PROCESSOR_BENCHMARKS_URL)).json()).devices

    console.log(`Fetched${benchmarks.length} processors. Fetching threads for each processor...`);

    const enrichedBenchmarks =[]
    for (let i = 0; i < benchmarks.length; i++) {
        const enrichStart = Date.now();
        const processor = benchmarks[i];

        try {
            const enriched = await enrichBenchmark(processor);
            enrichedBenchmarks.push(enriched)
        } catch (error) {
            console.error(`Failed to enrich benchmark for ${processor.name}: ${error.message}`);
        }

        const enrichEnd = Date.now();
        logIteration(enrichEnd, enrichStart, totalIterationTimeMs, iterationCount, benchmarks, processor, i);
    }
    // Export CPU list to JSON after scraping completes
    await exportCpuListToJson(enrichedBenchmarks, `cpu-list.v${VERSION_NO}.json`);
}

const enrichBenchmark = async (benchmark) => {
    const {description, ...processor} = benchmark; // we omit description for the enriched list since it's not needed after extracting frequency and core count
    processor.name = getSanitizedName(processor);
    const coreCount = description.match(/\((\d+) cores?\)/);
    const frequency = parseFrequencyGHz(description);
    const detailsUrls = buildProcessorDetailsUrls(processor.name);
    console.log(`fetching threads and boost frequency for ${processor.name} at ${detailsUrls[0]}`);
    const enrichedSpecs = await getProcessorSpecsFromUrls(detailsUrls, frequency, processor);
    return {
        ...processor,
        frequency,
        boost_frequency: enrichedSpecs.boostFrequency,
        cores: parseInt(coreCount[1], 10),
        threads: enrichedSpecs.threads
    };
};

async function getProcessorSpecsFromUrls(detailsUrls, frequency, processor) {
    let processorSpecs;
    for (url of detailsUrls) {
        try {
            processorSpecs = await fetchProcessorSpecsWithRetry(url, frequency);
            break; // if we succeed, no need to try other URLs
        } catch (error) {
            console.warn(`Failed to fetch details for ${processor.name} at ${url}: ${error.message}`);
        }
    }
    if (!processorSpecs) {
        console.error(`Failed to fetch details for ${processor.name} after trying all URL variations.`);
        throw new Error(`Failed to fetch details for ${processor.name}`);
    }
    return processorSpecs;
}

async function retryingFetchWithBackoff(url, retries = 8) {
    for (let attempt = 0; attempt < retries; attempt++) {
        const response = await fetch(url);
        if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After');
            fetchDelay *= 2; // Exponential backoff
            const waitTime = retryAfter ? (Number.parseInt(retryAfter, 10) * 1000) : fetchDelay;
            console.warn(`Received 429 Too Many Requests when fetching ${url}. Waiting ${waitTime}ms before retrying...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        } else {
            if (!response.ok) {
                throw new Error(`Failed to fetch details from ${url}: ${response.status} ${response.statusText}`);
            }
            return response;
        }
    }
    throw new Error(`Failed to fetch ${url} after ${retries} attempts due to repeated 429 responses.`);
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

/**
 * Creates the correct URL to scrape the data from, handling various naming inconsistencies in the Geekbench dataset.
 */
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

async function fetchProcessorSpecsWithRetry(detailsUrl, baseFrequency) {
    let resp = await retryingFetchWithBackoff(detailsUrl);
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

function getSanitizedName(processor) {
    let name = processor.name.trim()
    if (name === "AMD Ryzen Threadripper PRO 9985WX s") {
        // There's a typo in the original dataset
        name = "AMD Ryzen Threadripper PRO 9985WX"
    }
    return name;
}

function logIteration(enrichEnd, enrichStart, totalIterationTimeMs, iterationCount, benchmarks, processor, index) {
    const lastIterationTime = enrichEnd - enrichStart;
    totalIterationTimeMs += lastIterationTime;
    iterationCount++;
    const avgIterationTimeMs = totalIterationTimeMs / iterationCount;
    const remainingProcessors = benchmarks.length - index - 1;
    const estimatedTimeRemainingMin = (remainingProcessors * avgIterationTimeMs / 1000 / 60).toFixed(2);
    console.log(`${index + 1}/${benchmarks.length}: ${processor.name}. Estimated time remaining: ${estimatedTimeRemainingMin} minutes (avg ${(avgIterationTimeMs / 1000).toFixed(2)}s/cpu)`);
}
