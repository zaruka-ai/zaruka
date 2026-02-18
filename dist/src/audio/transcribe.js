const WHISPER_MODEL_NAME = 'sherpa-onnx-whisper-small';
const WHISPER_MODEL_URL = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${WHISPER_MODEL_NAME}.tar.bz2`;
export async function createTranscriber(opts) {
    // 1. Local Whisper via sherpa-onnx (free, offline, preferred)
    const local = await createLocalTranscriber();
    if (local) {
        console.log('Voice transcription: local Whisper (whisper-small, sherpa-onnx)');
        return local;
    }
    // 2. OpenAI Whisper API (paid)
    if (opts.openaiApiKey) {
        console.log('Voice transcription: OpenAI Whisper');
        return createCloudTranscriber(opts.openaiApiKey, 'whisper-1', opts.openaiBaseUrl);
    }
    // 3. Groq Whisper API (free)
    if (opts.groqApiKey) {
        console.log('Voice transcription: Groq Whisper');
        return createCloudTranscriber(opts.groqApiKey, 'whisper-large-v3', 'https://api.groq.com/openai/v1');
    }
    console.log('Voice transcription: disabled (ffmpeg required for local mode). Set GROQ_API_KEY for free cloud transcription.');
    return undefined;
}
async function createCloudTranscriber(apiKey, model, baseUrl) {
    const { default: OpenAI, toFile } = await import('openai');
    const client = new OpenAI({ apiKey, baseURL: baseUrl });
    return async (fileUrl) => {
        const res = await fetch(fileUrl);
        const buffer = Buffer.from(await res.arrayBuffer());
        const file = await toFile(buffer, 'voice.ogg');
        const result = await client.audio.transcriptions.create({ file, model });
        return result.text;
    };
}
async function ensureModel(modelsDir) {
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { mkdir } = await import('node:fs/promises');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const modelDir = join(modelsDir, WHISPER_MODEL_NAME);
    if (existsSync(join(modelDir, 'small-tokens.txt'))) {
        return modelDir;
    }
    await mkdir(modelsDir, { recursive: true });
    const archivePath = join(modelsDir, `${WHISPER_MODEL_NAME}.tar.bz2`);
    console.log(`Downloading Whisper model (~610 MB)...`);
    const startTime = Date.now();
    const heartbeat = setInterval(() => {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`  Still downloading... (${elapsed}s)`);
    }, 30_000);
    try {
        await execFileAsync('curl', ['-L', '-o', archivePath, WHISPER_MODEL_URL], { timeout: 600_000 });
        console.log('Download complete. Extracting...');
        await execFileAsync('tar', ['-xjf', archivePath, '-C', modelsDir], { timeout: 120_000 });
        // Clean up archive
        const { unlink } = await import('node:fs/promises');
        await unlink(archivePath).catch(() => { });
        console.log('Whisper model ready.');
    }
    finally {
        clearInterval(heartbeat);
    }
    return modelDir;
}
async function createLocalTranscriber() {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    try {
        await execFileAsync('ffmpeg', ['-version']);
    }
    catch {
        console.log('Local Whisper requires ffmpeg: brew install ffmpeg (macOS) / apt install ffmpeg (Linux)');
        return undefined;
    }
    const { writeFile, unlink } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { randomUUID } = await import('node:crypto');
    // Determine cache directory (XDG_CACHE_HOME or ~/.cache)
    const cacheDir = process.env.XDG_CACHE_HOME || join(process.env.HOME || '/tmp', '.cache');
    const modelsDir = join(cacheDir, 'sherpa-onnx-models');
    console.log('Loading Whisper model (sherpa-onnx, ~610 MB download on first run)...');
    const modelDir = await ensureModel(modelsDir);
    // sherpa-onnx-node is a native CJS addon — use createRequire for ESM compatibility
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sherpa;
    try {
        sherpa = require('sherpa-onnx-node');
    }
    catch {
        console.log('sherpa-onnx-node is not installed.');
        return undefined;
    }
    const recognizer = new sherpa.OfflineRecognizer({
        featConfig: {
            sampleRate: 16000,
            featureDim: 80,
        },
        modelConfig: {
            whisper: {
                encoder: join(modelDir, 'small-encoder.int8.onnx'),
                decoder: join(modelDir, 'small-decoder.int8.onnx'),
            },
            tokens: join(modelDir, 'small-tokens.txt'),
            numThreads: 2,
            provider: 'cpu',
            debug: 0,
        },
    });
    console.log('Whisper model loaded.');
    return async (fileUrl) => {
        const res = await fetch(fileUrl);
        const buffer = Buffer.from(await res.arrayBuffer());
        const id = randomUUID();
        const tempOgg = join(tmpdir(), `zaruka-${id}.ogg`);
        const tempWav = join(tmpdir(), `zaruka-${id}.wav`);
        try {
            await writeFile(tempOgg, buffer);
            // Convert OGG/Opus → WAV 16kHz mono via ffmpeg
            await execFileAsync('ffmpeg', [
                '-i', tempOgg,
                '-ar', '16000',
                '-ac', '1',
                '-f', 'wav',
                '-y', tempWav,
            ]);
            const wave = sherpa.readWave(tempWav);
            const stream = recognizer.createStream();
            stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples });
            recognizer.decode(stream);
            const result = recognizer.getResult(stream);
            return result.text || '';
        }
        finally {
            await unlink(tempOgg).catch(() => { });
            await unlink(tempWav).catch(() => { });
        }
    };
}
//# sourceMappingURL=transcribe.js.map