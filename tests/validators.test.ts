import { describe, it, expect } from 'vitest';
import { authSchema } from '../src/validators/auth.validator';
import { userSchema } from '../src/validators/user.validator';

const VALID_UUID = 'e60d8ebc-b9fe-11ef-b159-005056b4367d';
const VALID_DATETIME = '2026-01-15T12:00:00.000Z';

describe('authSchema.telegramAuth', () => {
  it('should accept a non-empty initData string', () => {
    expect(authSchema.telegramAuth.safeParse({ body: { initData: 'query_id=AAH…' } }).success).toBe(true);
  });

  it('should reject an empty initData string', () => {
    expect(authSchema.telegramAuth.safeParse({ body: { initData: '' } }).success).toBe(false);
  });

  it('should reject when initData is missing', () => {
    expect(authSchema.telegramAuth.safeParse({ body: {} }).success).toBe(false);
  });
});

describe('authSchema.refreshToken', () => {
  it('should accept a non-empty refresh token', () => {
    expect(authSchema.refreshToken.safeParse({ body: { refreshToken: 'token' } }).success).toBe(true);
  });

  it('should reject an empty refresh token', () => {
    expect(authSchema.refreshToken.safeParse({ body: { refreshToken: '' } }).success).toBe(false);
  });
});

describe('userSchema.updateProfile', () => {
  it('should accept an empty body (all fields optional)', () => {
    expect(userSchema.updateProfile.safeParse({ body: {} }).success).toBe(true);
  });

  it('should accept a valid reminder time with single-digit hour', () => {
    expect(userSchema.updateProfile.safeParse({ body: { reminderTime: '9:30' } }).success).toBe(true);
  });

  it('should accept boundary reminder time 23:59', () => {
    expect(userSchema.updateProfile.safeParse({ body: { reminderTime: '23:59' } }).success).toBe(true);
  });

  it('should reject reminder time 24:00', () => {
    expect(userSchema.updateProfile.safeParse({ body: { reminderTime: '24:00' } }).success).toBe(false);
  });

  it('should reject a malformed pregnancyStartDate', () => {
    expect(
      userSchema.updateProfile.safeParse({ body: { pregnancyStartDate: '15.01.2026' } }).success,
    ).toBe(false);
  });

  it('should accept a valid ISO pregnancyStartDate', () => {
    expect(
      userSchema.updateProfile.safeParse({ body: { pregnancyStartDate: VALID_DATETIME } }).success,
    ).toBe(true);
  });

  it('should reject non-boolean notificationsEnabled', () => {
    expect(
      userSchema.updateProfile.safeParse({ body: { notificationsEnabled: 'yes' } }).success,
    ).toBe(false);
  });
});

describe('userSchema.addChild', () => {
  it('should accept a valid child with gender MALE', () => {
    expect(
      userSchema.addChild.safeParse({
        body: { name: 'Aisha', birthDate: VALID_DATETIME, gender: 'MALE' },
      }).success,
    ).toBe(true);
  });

  it('should accept gender FEMALE', () => {
    expect(
      userSchema.addChild.safeParse({
        body: { name: 'Aisha', birthDate: VALID_DATETIME, gender: 'FEMALE' },
      }).success,
    ).toBe(true);
  });

  it('should accept gender OTHER', () => {
    expect(
      userSchema.addChild.safeParse({
        body: { name: 'Aisha', birthDate: VALID_DATETIME, gender: 'OTHER' },
      }).success,
    ).toBe(true);
  });

  it('should reject lowercase gender (enum is strict)', () => {
    expect(
      userSchema.addChild.safeParse({
        body: { name: 'Aisha', birthDate: VALID_DATETIME, gender: 'male' },
      }).success,
    ).toBe(false);
  });

  it('should accept a child without gender (optional)', () => {
    expect(
      userSchema.addChild.safeParse({ body: { name: 'Aisha', birthDate: VALID_DATETIME } }).success,
    ).toBe(true);
  });

  it('should reject an empty name', () => {
    expect(
      userSchema.addChild.safeParse({ body: { name: '', birthDate: VALID_DATETIME } }).success,
    ).toBe(false);
  });

  it('should reject a name longer than 50 characters', () => {
    expect(
      userSchema.addChild.safeParse({
        body: { name: 'a'.repeat(51), birthDate: VALID_DATETIME },
      }).success,
    ).toBe(false);
  });

  it('should reject a malformed birthDate', () => {
    expect(
      userSchema.addChild.safeParse({ body: { name: 'Aisha', birthDate: '2026-01-15' } }).success,
    ).toBe(false);
  });
});

describe('userSchema.updateChild', () => {
  it('should accept a valid uuid param with an empty body', () => {
    expect(
      userSchema.updateChild.safeParse({ params: { childId: VALID_UUID }, body: {} }).success,
    ).toBe(true);
  });

  it('should reject a non-uuid childId', () => {
    expect(
      userSchema.updateChild.safeParse({ params: { childId: 'not-a-uuid' }, body: {} }).success,
    ).toBe(false);
  });

  it('should reject lowercase gender in body', () => {
    expect(
      userSchema.updateChild.safeParse({
        params: { childId: VALID_UUID },
        body: { gender: 'female' },
      }).success,
    ).toBe(false);
  });
});

describe('userSchema.updateNotifications', () => {
  it('should accept enabled flag without reminder time', () => {
    expect(userSchema.updateNotifications.safeParse({ body: { enabled: true } }).success).toBe(true);
  });

  it('should reject when enabled is missing', () => {
    expect(userSchema.updateNotifications.safeParse({ body: {} }).success).toBe(false);
  });

  it('should reject an invalid reminder time', () => {
    expect(
      userSchema.updateNotifications.safeParse({ body: { enabled: true, reminderTime: '25:00' } })
        .success,
    ).toBe(false);
  });
});
