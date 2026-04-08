declare module "tiktoken" {
  export interface TiktokenEncoding {
    encode(text: string): number[];
  free?(): void;
  }

  export function encoding_for_model(model: string): TiktokenEncoding;
}
