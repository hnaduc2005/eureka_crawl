import handler from '../vote-dashboard/api/competitions.js';

export default {
  fetch(request) {
    return handler.fetch(request);
  },
};
