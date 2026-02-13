import { pipeline } from '@huggingface/transformers';
export async function createTranscriber(opts) {
    // 1. OpenAI Whisper API (paid)
    if (opts.openaiApiKey) {
        console.log('Voice transcription: OpenAI Whisper');
        return createCloudTranscriber(opts.openaiApiKey, 'whisper-1', opts.openaiBaseUrl);
    }
    // 2. Groq Whisper API (free)
    if (opts.groqApiKey) {
        console.log('Voice transcription: Groq Whisper');
        return createCloudTranscriber(opts.groqApiKey, 'whisper-large-v3', 'https://api.groq.com/openai/v1');
    }
    // 3. Local Whisper via @huggingface/transformers (free, offline)
    const local = await createLocalTranscriber();
    if (local) {
        console.log('Voice transcription: local Whisper');
        return local;
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
async function createLocalTranscriber() {
    // Check ffmpeg availability (required for audio conversion)
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
    const { writeFile, readFile, unlink } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { randomUUID } = await import('node:crypto');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pipelineInstance = null;
    return async (fileUrl) => {
        // Lazy-load model on first call
        if (!pipelineInstance) {
            console.log('Loading Whisper model (first time, ~75MB download)...');
            pipelineInstance = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny');
            console.log('Whisper model loaded.');
        }
        // Download audio from Telegram
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
            // Read WAV and extract PCM samples as Float32Array
            const wavBuffer = await readFile(tempWav);
            const pcmData = parseWavToFloat32(wavBuffer);
            const result = await pipelineInstance(pcmData);
            return result.text || '';
        }
        finally {
            await unlink(tempOgg).catch(() => { });
            await unlink(tempWav).catch(() => { });
        }
    };
}
function parseWavToFloat32(wavBuffer) {
    // Standard WAV: 44-byte header, then 16-bit PCM samples
    // Find the 'data' chunk for robustness
    let dataOffset = 44;
    for (let i = 12; i < wavBuffer.length - 8; i++) {
        if (wavBuffer[i] === 0x64 && // 'd'
            wavBuffer[i + 1] === 0x61 && // 'a'
            wavBuffer[i + 2] === 0x74 && // 't'
            wavBuffer[i + 3] === 0x61 // 'a'
        ) {
            dataOffset = i + 8; // skip 'data' + 4-byte size
            break;
        }
    }
    const numSamples = (wavBuffer.length - dataOffset) / 2;
    const samples = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
        samples[i] = wavBuffer.readInt16LE(dataOffset + i * 2) / 32768;
    }
    return samples;
}
//# sourceMappingURL=transcribe.js.map