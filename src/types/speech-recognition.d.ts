export {};

declare global {
  interface SpeechRecognitionAlternativeLike {
    readonly transcript: string;
    readonly confidence: number;
  }

  interface SpeechRecognitionResultLike {
    readonly isFinal: boolean;
    readonly length: number;
    item(index: number): SpeechRecognitionAlternativeLike;
    [index: number]: SpeechRecognitionAlternativeLike;
  }

  interface SpeechRecognitionResultListLike {
    readonly length: number;
    item(index: number): SpeechRecognitionResultLike;
    [index: number]: SpeechRecognitionResultLike;
  }

  interface SpeechRecognitionEventLike extends Event {
    readonly resultIndex: number;
    readonly results: SpeechRecognitionResultListLike;
  }

  interface SpeechRecognitionErrorEventLike extends Event {
    readonly error: string;
    readonly message: string;
  }

  interface SpeechRecognitionLike extends EventTarget {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    start(): void;
    stop(): void;
    abort(): void;
    onresult: ((event: SpeechRecognitionEventLike) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
    onend: (() => void) | null;
  }

  interface SpeechRecognitionConstructorLike {
    new (): SpeechRecognitionLike;
  }

  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructorLike;
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
  }
}