const GEEKBENCH_PROCESSOR_BENCHMARKS_URL = "https://browser.geekbench.com/processor-benchmarks.json";
const VERSION_NO = "1";

// Delay will increase each time we hit a 429 (exponential back-off)
const initialFetchDelay = 50;

const args = process.argv.slice(2);
const outputFileName = args[0] || `cpu-list.v${VERSION_NO}.json`;

/**
 * Fetches list of geekbench processors. Enriching the results by scraping each processor's details page to get thread count and boost frequency, which are not included in the initial JSON response. Exports the enriched list to a JSON file.
 */
async function main() {
    let iterationCount = 0;
    log.step("Fetching benchmarks list...");
    const benchmarks = (await (await retryingFetchWithBackoff(GEEKBENCH_PROCESSOR_BENCHMARKS_URL)).json()).devices

    log.success(`Fetched ${COLORS.bright}${benchmarks.length}${COLORS.reset} processors.`);

    const enrichedBenchmarks = {};
    for (let i = 0; i < benchmarks.length; i++) {
        const enrichStart = Date.now();
        const processor = benchmarks[i];

        try {
            enrichedBenchmarks[processor.name] = await enrichBenchmark(processor);
        } catch (error) {
            process.stdout.write('\n');
            log.error(`Failed to enrich benchmark for ${processor.name}: ${error.message}`);
        }

        const enrichEnd = Date.now();
        logIteration(enrichEnd, enrichStart, iterationCount, benchmarks, processor, i);
    }
    process.stdout.write('\n');
    log.step("Finalizing...");
    // Export CPU list to JSON after scraping completes
    await exportCpuListToJson(enrichedBenchmarks, outputFileName);
}

const enrichBenchmark = async (benchmark) => {
    const {description, ...processor} = benchmark;
    processor.name = getSanitizedName(processor);
    const coreCount = description.match(/\((\d+) cores?\)/);
    const frequency = parseFrequencyGHz(description);
    const detailsUrls = buildProcessorDetailsUrls(processor.name);
    const enrichedSpecs = await getProcessorSpecsFromUrls(detailsUrls, frequency, processor);
    // we omit description for the enriched list since it's not needed after extracting frequency and core count
    return {
        ...processor,
        frequency,
        boost_frequency: enrichedSpecs.boostFrequency,
        cores: parseInt(coreCount[1], 10),
        performance_cores: enrichedSpecs.performanceCores,
        efficiency_cores: enrichedSpecs.efficiencyCores,
        threads: enrichedSpecs.threads,
        package: enrichedSpecs.package,
        tdp: enrichedSpecs.tdp,
        gpu: enrichedSpecs.gpu
    };
};

async function getProcessorSpecsFromUrls(detailsUrls, frequency, processor) {
    let processorSpecs;
    for (const url of detailsUrls) {
        try {
            processorSpecs = await fetchProcessorSpecsWithRetry(url, frequency);
            break;
        } catch (error) {
            // WIll attempt next URL variation if there's an error
        }
    }
    if (!processorSpecs) {
        console.error(`Failed to fetch details for ${processor.name} after trying all URL variations.`);
        throw new Error(`Failed to fetch details for ${processor.name}`);
    }
    return processorSpecs;
}

async function retryingFetchWithBackoff(url, retries = 8) {
    let fetchDelay = initialFetchDelay;
    for (let attempt = 0; attempt < retries; attempt++) {
        const response = await fetch(url);
        if (response.status === 429) {
            // Respect the Retry-After header if present, otherwise use exponential backoff
            const retryAfter = response.headers.get('Retry-After');
            fetchDelay *= 2;
            const waitTime = retryAfter ? (Number.parseInt(retryAfter, 10) * 1000) : fetchDelay;
            process.stdout.write('\n');
            log.warn(`Rate limit hit for ${url}. Waiting ${(waitTime / 1000).toFixed(1)}s...`);
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
        buildProcessorDetailsUrl(name, { withRadeonGraphics: true }),
    ];
    return [...new Set(urls)];
}

function buildProcessorDetailsUrl(name, { withRadeonGraphics = false } = {}) {
    let slug = name
        .replace(/\+/g, '')
        .replace(/\//g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .toLowerCase();
    // A specific cpu has this in it's URL for some reason, but not in it's name.
    if (withRadeonGraphics && !slug.endsWith('-with-radeon-graphics')) {
        slug += '-with-radeon-graphics';
    }
    return `https://browser.geekbench.com/processors/${slug}`;
}

async function fetchProcessorSpecsWithRetry(detailsUrl, baseFrequency) {
    let resp = await retryingFetchWithBackoff(detailsUrl);
    const scrapedHTML = await resp.text();
    const rawTdp = extractSystemValueFromHtml(scrapedHTML, 'TDP');
    const tdp = rawTdp ? parseInt(rawTdp.replace(/[^0-9]/g, ''), 10) : null;

    const rawMaxTdp = extractSystemValueFromHtml(scrapedHTML, 'Maximum Power');
    const maxTdp = rawMaxTdp ? parseInt(rawMaxTdp.replace(/[^0-9]/g, ''), 10) : tdp;

    const rawPcores = extractSystemValueFromHtml(scrapedHTML, 'Performance Cores');
    const rawEcores = extractSystemValueFromHtml(scrapedHTML, 'Efficient Cores');

    return {
        threads: extractThreadsFromHtml(scrapedHTML),
        boostFrequency: extractBoostFrequencyFromHtml(scrapedHTML, baseFrequency),
        performanceCores: rawPcores ? parseInt(rawPcores.replace(/[^0-9]/g, ''), 10) : null,
        efficiencyCores: rawEcores ? parseInt(rawEcores.replace(/[^0-9]/g, ''), 10) : null,
        package: extractSystemValueFromHtml(scrapedHTML, 'Package'),
        tdp: tdp,
        max_tdp: maxTdp,
        gpu: extractSystemValueFromHtml(scrapedHTML, 'GPU')
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

async function exportCpuListToJson(cpuList, filename) {
    const json = JSON.stringify(cpuList, null, 2);

    try {
        const fs = require('fs').promises;
        await fs.writeFile(filename, json, 'utf8');
        log.success(`JSON written to ${COLORS.bright}${filename}${COLORS.reset}`);
    } catch (err) {
        log.error(`Failed to write JSON file: ${err.message}`);
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

let avgIterationTimeMs;
function logIteration(enrichEnd, enrichStart, iterationCount, benchmarks, processor, index) {
    const lastIterationTime = enrichEnd - enrichStart;

    // Use a weighted moving average for iteration time
    const weight = 0.4; // The higher the weight, the more influence the last iteration has on the average
    avgIterationTimeMs = iterationCount === 0
        ? lastIterationTime
        : (weight * lastIterationTime + (1 - weight) * (avgIterationTimeMs || 0));

    iterationCount++;

    const remainingProcessors = benchmarks.length - index - 1;
    const estimatedTimeRemainingMin = (remainingProcessors * avgIterationTimeMs / 1000 / 60).toFixed(2);
    log.progress(index + 1, benchmarks.length, processor.name, estimatedTimeRemainingMin, (avgIterationTimeMs / 1000).toFixed(2));
}

const COLORS = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    blue: "\x1b[34m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    magenta: "\x1b[35m"
};

const log = {
    info: (msg) => console.log(`${COLORS.blue}ℹ${COLORS.reset} ${msg}`),
    success: (msg) => console.log(`${COLORS.green}✔${COLORS.reset} ${msg}`),
    warn: (msg) => console.warn(`${COLORS.yellow}⚠${COLORS.reset} ${COLORS.yellow}${msg}${COLORS.reset}`),
    error: (msg) => console.error(`${COLORS.red}✖${COLORS.reset} ${COLORS.bright}${COLORS.red}${msg}${COLORS.reset}`),
    step: (msg) => console.log(`${COLORS.cyan}➤${COLORS.reset} ${COLORS.bright}${msg}${COLORS.reset}`),
    progress: (current, total, name, eta, avg) => {
        const percent = Math.round((current / total) * 100);
        const barLength = 20;
        const filledLength = Math.round((current / total) * barLength);
        const bar = "█".repeat(filledLength) + "░".repeat(barLength - filledLength);
        process.stdout.write(`\r${COLORS.cyan}[${bar}]${COLORS.reset} ${COLORS.bright}${percent}%${COLORS.reset} | ${COLORS.dim}${current}/${total}${COLORS.reset} | ${COLORS.blue}${name}${COLORS.reset} | ${COLORS.yellow}ETA: ${eta}m${COLORS.reset} (${COLORS.dim}${avg}s/cpu${COLORS.reset})      `);
    }
};

// Entry point
main().catch(err => {
    console.error("Error fetching CPU data:", err);
    process.exitCode = 1;
});
