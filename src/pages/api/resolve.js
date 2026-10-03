import { handleApiRequest } from '../../../lib/reelstash.js';

export const prerender = false;

export const config = {
  maxDuration: 60
};

export function POST({ request }) {
  return handleApiRequest(request);
}

export function OPTIONS({ request }) {
  return handleApiRequest(request);
}
