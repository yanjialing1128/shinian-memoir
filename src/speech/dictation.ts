export interface DictationHandlers {
  readonly onFinalText: (text: string) => void;
  readonly onInterimText: (text: string) => void;
  readonly onStateChange: (listening: boolean) => void;
  readonly onError: (message: string) => void;
}

export interface DictationController {
  readonly supported: boolean;
  start(): void;
  stop(): void;
  toggle(): void;
}

function errorMessage(error: string): string {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return '浏览器没有获得麦克风权限。';
    case 'no-speech':
      return '没有听清，请靠近麦克风再说一次。';
    case 'audio-capture':
      return '没有找到可用的麦克风。';
    case 'network':
      return '语音识别服务暂时无法连接。';
    default:
      return '语音识别中断了，请再试一次。';
  }
}

export function createDictation(handlers: DictationHandlers): DictationController {
  const Recognition =
    window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
  if (!Recognition) {
    return {
      supported: false,
      start: () => handlers.onError('当前浏览器不支持语音输入，请使用新版 Chrome 或 Edge。'),
      stop: () => undefined,
      toggle: () => handlers.onError('当前浏览器不支持语音输入，请使用新版 Chrome 或 Edge。'),
    };
  }

  const recognition = new Recognition();
  recognition.lang = 'zh-CN';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let finalText = '';
    let interimText = '';
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result?.[0]?.transcript ?? '';
      if (result?.isFinal) {
        finalText += transcript;
      } else {
        interimText += transcript;
      }
    }

    if (finalText) {
      handlers.onFinalText(finalText);
    }
    handlers.onInterimText(interimText);
  };

  recognition.onerror = (event) => {
    handlers.onError(errorMessage(event.error));
  };

  recognition.onend = () => {
    handlers.onInterimText('');
    handlers.onStateChange(false);
  };

  return {
    supported: true,
    start: () => {
      try {
        recognition.start();
        handlers.onStateChange(true);
      } catch {
        handlers.onStateChange(false);
      }
    },
    stop: () => {
      recognition.stop();
      handlers.onStateChange(false);
    },
    toggle: () => {
      try {
        recognition.start();
        handlers.onStateChange(true);
      } catch {
        recognition.stop();
        handlers.onStateChange(false);
      }
    },
  };
}