import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startWeixinLoginWithQr, waitForWeixinLogin } from './login-qr.js';
import * as apiModule from '../api/api.js';

describe('startWeixinLoginWithQr', () => {
  it('should return sessionKey on success', async () => {
    vi.spyOn(apiModule, 'apiGetFetch').mockResolvedValueOnce(
      JSON.stringify({ qrcode: 'test-qr', qrcode_img_content: 'https://qr.url/test' })
    );

    const result = await startWeixinLoginWithQr({ apiBaseUrl: 'https://ilinkai.weixin.qq.com' });
    expect(result.sessionKey).toBeDefined();
    expect(result.qrcodeUrl).toBe('https://qr.url/test');
    expect(result.message).toBeTruthy();

    vi.restoreAllMocks();
  });

  it('should return error message on failure', async () => {
    vi.spyOn(apiModule, 'apiGetFetch').mockRejectedValueOnce(new Error('Network error'));

    const result = await startWeixinLoginWithQr({});
    expect(result.qrcodeUrl).toBeUndefined();
    expect(result.message).toContain('Network error');

    vi.restoreAllMocks();
  });
});
