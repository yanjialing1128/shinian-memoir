export {};

declare global {
  interface FileSystemPermissionDescriptor {
    mode?: 'read' | 'readwrite';
  }

  interface FileSystemWritableFileStream {
    write(data: string | BufferSource | Blob): Promise<void>;
    close(): Promise<void>;
  }

  interface FileSystemFileHandle {
    readonly kind: 'file';
    readonly name: string;
    getFile(): Promise<File>;
    createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>;
  }

  interface FileSystemDirectoryHandle {
    readonly kind: 'directory';
    readonly name: string;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
    removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
    queryPermission(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>;
    requestPermission(descriptor?: FileSystemPermissionDescriptor): Promise<PermissionState>;
    values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
  }

  interface Window {
    showDirectoryPicker?(options?: {
      id?: string;
      mode?: 'read' | 'readwrite';
      startIn?: string;
    }): Promise<FileSystemDirectoryHandle>;
  }
}