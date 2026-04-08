declare module "tiktoken" {
  export interface TiktokenEncoding {
    encode(text: string): number[];
  }

  export function encoding_for_model(model: string): TiktokenEncoding;
}
