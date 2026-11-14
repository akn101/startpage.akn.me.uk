// Text-to-speech for the TV (it has no TTS engine): AWS Polly neural voice,
// using the same AWS credentials/region as Bedrock.
import { PollyClient, SynthesizeSpeechCommand, type VoiceId } from "@aws-sdk/client-polly";

export const MAX_SPEAK = 1500;

export function pollyConfigured() {
  return !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

/** The prod AWS_REGION value carries a stray literal "\n"; strip it and whitespace. */
export const awsRegion = (r: string | undefined) => (r ?? "").replace(/\\n/g, "").trim() || "eu-west-1";

let client: PollyClient | null = null;
function polly() {
  client ??= new PollyClient({
    region: awsRegion(process.env.POLLY_REGION ?? process.env.AWS_REGION),
    credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID!.trim(), secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!.trim() },
  });
  return client;
}

/** MP3 bytes for the text (already trimmed/capped by the caller). */
export async function synthesize(text: string): Promise<Uint8Array> {
  const r = await polly().send(
    new SynthesizeSpeechCommand({
      Engine: "neural",
      OutputFormat: "mp3",
      SampleRate: "24000",
      TextType: "text",
      VoiceId: (process.env.POLLY_VOICE ?? "Joanna") as VoiceId,
      Text: text,
    }),
  );
  if (!r.AudioStream) throw new Error("polly: empty audio");
  return r.AudioStream.transformToByteArray();
}
