import {pathToFileURL} from 'node:url';
import {handleFatalError, runCliApp} from './main.js';

export {buildCLI} from './program.js';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCliApp().catch((error: unknown) => {
    handleFatalError(error);
  });
}
