import { describe, expect, it } from 'vitest';
import { normalizeSSN, sanitizeLeadFields } from '../src/lib/lead-fields';

describe('sanitizeLeadFields', () => {
  it('keeps only allowed keys', () => {
    const result = sanitizeLeadFields({ customerName: 'Jane', ssn: '123456789', notAField: 'x' }, ['customerName']);
    expect(result).toEqual({ data: { customerName: 'Jane' } });
  });

  it('skips undefined, null and empty-string values', () => {
    const result = sanitizeLeadFields({ customerName: '', state: null, age: undefined }, ['customerName', 'state', 'age']);
    expect(result).toEqual({ data: {} });
  });

  it('rejects a non-object body', () => {
    expect(sanitizeLeadFields(null, ['customerName'])).toEqual({ error: 'Invalid request body' });
    expect(sanitizeLeadFields('x', ['customerName'])).toEqual({ error: 'Invalid request body' });
  });

  it('enforces enum values', () => {
    expect(sanitizeLeadFields({ gender: 'Female' }, ['gender'])).toEqual({ data: { gender: 'Female' } });
    expect(sanitizeLeadFields({ gender: 'other' }, ['gender'])).toEqual({ error: 'Invalid gender' });
  });

  it('coerces ints and booleans', () => {
    expect(sanitizeLeadFields({ age: '71.9', smoker: 'false' }, ['age', 'smoker'])).toEqual({
      data: { age: 71, smoker: false },
    });
    expect(sanitizeLeadFields({ age: 'old' }, ['age'])).toEqual({ error: 'Invalid age' });
    expect(sanitizeLeadFields({ smoker: 'yes' }, ['smoker'])).toEqual({ error: 'Invalid smoker' });
  });

  it('parses dates and rejects garbage', () => {
    const result = sanitizeLeadFields({ dob: '1950-02-03' }, ['dob']);
    expect('data' in result && result.data.dob instanceof Date).toBe(true);
    expect(sanitizeLeadFields({ dob: 'not a date' }, ['dob'])).toEqual({ error: 'Invalid dob' });
  });

  it('normalizes phone numbers, 9 digits by default and 10 for retention', () => {
    expect(sanitizeLeadFields({ phone: '555 234 567' }, ['phone'])).toEqual({ data: { phone: '555-234-567' } });
    expect('error' in sanitizeLeadFields({ phone: '5552345678' }, ['phone'])).toBe(true);
    expect(sanitizeLeadFields({ phone: '5552345678' }, ['phone'], { retention: true })).toEqual({
      data: { phone: '555-234-5678' },
    });
  });

  it('validates zipcodes', () => {
    expect(sanitizeLeadFields({ zipcode: ' 90210 ' }, ['zipcode'])).toEqual({ data: { zipcode: '90210' } });
    expect('error' in sanitizeLeadFields({ zipcode: '9021' }, ['zipcode'])).toBe(true);
  });
});

describe('normalizeSSN', () => {
  it('formats as xxx-xx-xxxx', () => {
    expect(normalizeSSN('123456789')).toBe('123-45-6789');
    expect(normalizeSSN('123-45-6789')).toBe('123-45-6789');
  });
});
