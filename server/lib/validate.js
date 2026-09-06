import { ApiError } from './errors.js';
import { isValidDate } from './dates.js';

/**
 * A tiny schema validator.
 *
 * Rules are declared per field and applied in order; the first failure for a
 * field wins. `validate` collects *every* field error before throwing so the
 * client can highlight a whole form in one round-trip.
 */
export const v = {
  string({ min = 0, max = 5000, trim = true, lower = false } = {}) {
    return (value, field) => {
      if (typeof value !== 'string') throw fieldError(field, 'must be text');
      let out = trim ? value.trim() : value;
      if (lower) out = out.toLowerCase();
      if (out.length < min) throw fieldError(field, `must be at least ${min} characters`);
      if (out.length > max) throw fieldError(field, `must be at most ${max} characters`);
      return out;
    };
  },
  email() {
    return (value, field) => {
      const out = String(value ?? '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(out) || out.length > 254) {
        throw fieldError(field, 'must be a valid email address');
      }
      return out;
    };
  },
  password() {
    return (value, field) => {
      const out = String(value ?? '');
      if (out.length < 8) throw fieldError(field, 'must be at least 8 characters');
      if (out.length > 200) throw fieldError(field, 'is too long');
      if (!/[a-z]/i.test(out) || !/[0-9]/.test(out)) {
        throw fieldError(field, 'must contain both letters and numbers');
      }
      return out;
    };
  },
  int({ min = -1e9, max = 1e9 } = {}) {
    return (value, field) => {
      const out = Number(value);
      if (!Number.isFinite(out) || !Number.isInteger(out)) throw fieldError(field, 'must be a whole number');
      if (out < min || out > max) throw fieldError(field, `must be between ${min} and ${max}`);
      return out;
    };
  },
  number({ min = -1e12, max = 1e12 } = {}) {
    return (value, field) => {
      const out = Number(value);
      if (!Number.isFinite(out)) throw fieldError(field, 'must be a number');
      if (out < min || out > max) throw fieldError(field, `must be between ${min} and ${max}`);
      return out;
    };
  },
  bool() {
    return (value) => (value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0);
  },
  oneOf(options) {
    return (value, field) => {
      const out = String(value ?? '');
      if (!options.includes(out)) throw fieldError(field, `must be one of: ${options.join(', ')}`);
      return out;
    };
  },
  date() {
    return (value, field) => {
      const out = String(value ?? '').slice(0, 10);
      if (!isValidDate(out)) throw fieldError(field, 'must be a date in YYYY-MM-DD format');
      return out;
    };
  },
  time() {
    return (value, field) => {
      const out = String(value ?? '').trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(out)) throw fieldError(field, 'must be a time in HH:MM format');
      return out;
    };
  },
  color() {
    return (value, field) => {
      const out = String(value ?? '').trim();
      if (!/^#[0-9a-f]{6}$/i.test(out)) throw fieldError(field, 'must be a hex colour like #6366f1');
      return out.toLowerCase();
    };
  },
  /** Comma separated whole numbers, e.g. weekday or month-day selections. */
  numberList({ min = 0, max = 31 } = {}) {
    return (value, field) => {
      if (value === '' || value === null || value === undefined) return '';
      const parts = Array.isArray(value) ? value : String(value).split(',');
      const nums = parts
        .map((p) => Number(String(p).trim()))
        .filter((n) => Number.isInteger(n));
      if (nums.some((n) => n < min || n > max)) throw fieldError(field, `values must be between ${min} and ${max}`);
      return [...new Set(nums)].sort((a, b) => a - b).join(',');
    };
  },
  /** Allows an explicit null while still validating non-null values. */
  nullable(rule) {
    return (value, field) => (value === null || value === undefined || value === '' ? null : rule(value, field));
  },
  emoji() {
    return (value, field) => {
      const out = String(value ?? '').trim();
      if (!out || [...out].length > 4) throw fieldError(field, 'must be a short emoji');
      return out;
    };
  },
};

function fieldError(field, message) {
  const err = new Error(`${field} ${message}`);
  err.field = field;
  return err;
}

/**
 * @param {object} body    raw request body
 * @param {object} schema  { field: rule | { rule, default, optional } }
 * @param {object} options { partial: true } skips fields absent from the body,
 *                         which is what PATCH endpoints want.
 */
export function validate(body, schema, { partial = false } = {}) {
  const source = body && typeof body === 'object' ? body : {};
  const out = {};
  const errors = {};

  for (const [field, spec] of Object.entries(schema)) {
    const rule = typeof spec === 'function' ? spec : spec.rule;
    const hasDefault = typeof spec === 'object' && 'default' in spec;
    const optional = typeof spec === 'object' && spec.optional === true;
    const present = Object.prototype.hasOwnProperty.call(source, field);

    if (!present) {
      if (partial) continue;
      if (hasDefault) { out[field] = spec.default; continue; }
      if (optional) continue;
      errors[field] = `${field} is required`;
      continue;
    }

    try {
      out[field] = rule(source[field], field);
    } catch (err) {
      errors[field] = err.message;
    }
  }

  if (Object.keys(errors).length) {
    throw ApiError.badRequest('Please check the highlighted fields', errors);
  }
  return out;
}
