import handler from '../vote-dashboard/api/snapshot.js';

export default {
  fetch(request) {
    return handler.fetch(request);
  },
};
