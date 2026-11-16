/**
 * 把一段文本存成文件交给用户。
 * 手机端走「写入缓存 + 系统分享」，浏览器/桌面端走 Blob 下载。
 */
import { Capacitor } from '@capacitor/core';

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      // readAsDataURL 返回 data:...;base64,xxxx
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('读取失败'));
    reader.readAsDataURL(blob);
  });
}

export async function saveTextFile(fileName: string, text: string, mime = 'application/json'): Promise<void> {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });

  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const written = await Filesystem.writeFile({
      path: `ddl-export/${fileName}`,
      data: await blobToBase64(blob),
      directory: Directory.Cache,
      recursive: true,
    });
    const canShare = await Share.canShare();
    if (!canShare.value) throw new Error('当前设备没有可用于保存文件的应用');
    await Share.share({ title: fileName, url: written.uri, dialogTitle: '保存备份' });
    return;
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
