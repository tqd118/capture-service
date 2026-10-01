type Priority = 'low' | 'medium' | 'high';

function log(priority: Priority, message: string): void {
  const line = `[${new Date().toISOString()}] [${priority}] ${message}`;
  if (priority === 'high') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  low: (message: string) => log('low', message),
  medium: (message: string) => log('medium', message),
  high: (message: string) => log('high', message),
};
