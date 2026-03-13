const SECRET_KEY_PATTERN = /(KEY|TOKEN|SECRET|PASSWORD)/i;

export function shouldMaskKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function maskSecretValue(value: string): string {
  if (value.length <= 4) {
    return '*'.repeat(value.length);
  }

  return `${value.slice(0, 2)}${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-2)}`;
}

