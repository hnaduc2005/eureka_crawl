import worker from '../worker/index.js';

// Keep the query string intact, including competition and refresh parameters.
export default {
  fetch(request) {
    return worker.fetch(request);
  },
};
