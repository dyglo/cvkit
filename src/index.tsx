import process from 'node:process';
import {handleFatalError, runCliApp} from './main.js';

void runCliApp().catch((error: unknown) => {
  handleFatalError(error);
});
