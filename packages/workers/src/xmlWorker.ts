import { handleWorkerRequest } from './handler';

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  const response = handleWorkerRequest(event.data);
  self.postMessage(response);
});
