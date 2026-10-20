import {
  formatCardExpiry,
  formatFileSize,
  formatMoney,
  formatPhone,
  formatPhoneInput,
  formatPkr,
  getAvatarTone,
  getInitials,
  humanizeEnum,
  isValidUsPhone,
  isValidZip,
  maskAccount,
  maskSsn,
  pluralize,
} from './format-utils';
import { apiErrorMessage } from './api';

describe('format-utils', () => {
  it('formats money as whole USD and PKR', () => {
    expect(formatMoney(12500)).toBe('$12,500');
    expect(formatMoney(null)).toBe('—');
    expect(formatPkr(12500)).toBe('PKR 12,500');
    expect(formatPkr(undefined)).toBe('—');
  });

  it('humanizes enum values', () => {
    expect(humanizeEnum('SELF_EMPLOYED')).toBe('Self employed');
    expect(humanizeEnum(null)).toBe('—');
  });

  it('builds initials and stable avatar tones', () => {
    expect(getInitials('jane van doe')).toBe('JV');
    expect(getInitials('')).toBe('?');
    expect(getAvatarTone('user-1')).toBe(getAvatarTone('user-1'));
    expect(getAvatarTone(null)).toBe('tone-a');
  });

  it('formats phones while typing and for display', () => {
    expect(formatPhoneInput('555')).toBe('555');
    expect(formatPhoneInput('55523')).toBe('555-23');
    expect(formatPhoneInput('5552345678')).toBe('555-234-567');
    expect(formatPhoneInput('5552345678', 10)).toBe('555-234-5678');
    expect(formatPhone('555234567')).toBe('555-234-567');
    expect(formatPhone(null)).toBe('—');
  });

  it('validates phones and zips the same way the server does', () => {
    expect(isValidUsPhone('555-234-567')).toBe(true);
    expect(isValidUsPhone('5552345678')).toBe(false);
    expect(isValidUsPhone('5552345678', 10)).toBe(true);
    expect(isValidZip(' 90210 ')).toBe(true);
    expect(isValidZip('9021')).toBe(false);
  });

  it('formats card expiry as MM/YY', () => {
    expect(formatCardExpiry('1')).toBe('1');
    expect(formatCardExpiry('1225')).toBe('12/25');
    expect(formatCardExpiry('12/259')).toBe('12/25');
  });

  it('masks sensitive values down to the last four', () => {
    expect(maskSsn('123-45-6789')).toBe('•••-••-6789');
    expect(maskSsn('12')).toBe('•••-••-••••');
    expect(maskAccount('000123456789')).toBe('••••6789');
    expect(maskAccount('123')).toBe('••••');
  });

  it('pluralizes and sizes files', () => {
    expect(pluralize(1, 'lead')).toBe('1 lead');
    expect(pluralize(1200, 'lead')).toBe('1,200 leads');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('apiErrorMessage', () => {
  it('reads the server { error } message', () => {
    expect(apiErrorMessage({ error: { error: 'Lead not found' } }, 'fallback')).toBe('Lead not found');
  });

  it('falls back when there is none', () => {
    expect(apiErrorMessage(new Error('network'), 'fallback')).toBe('fallback');
    expect(apiErrorMessage(null, 'fallback')).toBe('fallback');
    expect(apiErrorMessage({ error: 'plain text body' }, 'fallback')).toBe('fallback');
  });
});
