import {installConfig,installModelBundle} from './lib/install-model-bundle.mjs';
try{console.log(JSON.stringify(await installModelBundle(installConfig()),null,2));}
catch(error){console.error('Model installation failed:',error.message);process.exitCode=1;}
