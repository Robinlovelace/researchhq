import { asset } from '$app/paths';
import type { PortfolioSnapshot } from '@researchhq/schema';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
  const response = await fetch(asset('data/portfolio.json'));
  if (!response.ok) {
    throw new Error(`Failed to load portfolio snapshot (${response.status})`);
  }
  const snapshot = (await response.json()) as PortfolioSnapshot;
  return { snapshot };
};
