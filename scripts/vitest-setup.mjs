// vitest globalSetup: sınamalardan önce keşif dizinlerini yeniler.
import { generateIndexes } from './gen-index.mjs';

export default function setup() {
  generateIndexes();
}
