import worker from '../worker/index.js';

// Vercel's Node.js runtime accepts the Web Standard Request/Response interface.
export default {
  fetch(request) {
    return worker.fetch(request);
  },
};
