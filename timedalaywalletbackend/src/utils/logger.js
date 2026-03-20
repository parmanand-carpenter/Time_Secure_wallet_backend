const colors = {
  reset:  "\x1b[0m",
  info:   "\x1b[36m",
  success:"\x1b[32m",
  warn:   "\x1b[33m",
  error:  "\x1b[31m",
};

function timestamp() {
  return new Date().toISOString();
}

export const logger = {
  info:    (msg) => console.log(`${colors.info}[INFO]${colors.reset}  ${timestamp()} — ${msg}`),
  success: (msg) => console.log(`${colors.success}[OK]${colors.reset}    ${timestamp()} — ${msg}`),
  warn:    (msg) => console.log(`${colors.warn}[WARN]${colors.reset}  ${timestamp()} — ${msg}`),
  error:   (msg) => console.log(`${colors.error}[ERROR]${colors.reset} ${timestamp()} — ${msg}`),
};
