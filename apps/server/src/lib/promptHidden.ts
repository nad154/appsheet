import readline from 'node:readline';
import { Writable } from 'node:stream';

export function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('promptHidden requires an interactive terminal');
  }

  return new Promise((resolve, reject) => {
    let answer = '';
    const mutedOutput = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: mutedOutput,
      terminal: true,
    });

    const onSigInt = () => {
      rl.close();
      reject(new Error('Cancelled'));
    };

    process.once('SIGINT', onSigInt);

    process.stdout.write(question);

    rl.question('', (input) => {
      process.removeListener('SIGINT', onSigInt);
      rl.close();
      answer = input ?? '';
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}
