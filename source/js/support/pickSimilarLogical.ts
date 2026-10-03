import type {Logical} from '../vpn/Logical';
import type {UserContext} from '../account/user/UserContext';
import {getBestLogical} from '../vpn/getLogical';
import {Feature} from '../vpn/Feature';

/** Features that change how a site sees the connection: keep them identical when possible. */
const relevantFeatures =
	Feature.SECURE_CORE | Feature.STREAMING | Feature.P2P | Feature.TOR;

export interface CurrentServer {
	id: Logical['ID'];
	exitCountry: string;
	exitEnglishCity?: string | null;
}

/**
 * Pick the server closest to the current one (same city, then same country,
 * same features when possible) that has not been tried yet, choosing the best
 * score among equivalent candidates.
 */
export const pickSimilarLogical = (
	logicals: Logical[],
	current: CurrentServer | undefined,
	excludedIds: Logical['ID'][],
	userContext: UserContext,
): Logical | undefined => {
	const excluded = new Set(
		[...excludedIds, ...(current ? [current.id] : [])].map(String),
	);
	const candidates = logicals.filter(
		(logical) => !excluded.has(String(logical.ID)),
	);

	if (!current) {
		return getBestLogical(candidates, userContext);
	}

	const currentLogical = logicals.find(
		(logical) => String(logical.ID) === String(current.id),
	);
	const features = (currentLogical?.Features ?? 0) & relevantFeatures;
	const sameCountry = (logical: Logical) =>
		logical.ExitCountry === current.exitCountry;
	const sameCity = (logical: Logical) =>
		sameCountry(logical) &&
		!!current.exitEnglishCity &&
		logical.City === current.exitEnglishCity;
	const sameFeatures = (logical: Logical) =>
		(logical.Features & relevantFeatures) === features;

	const tiers: ((logical: Logical) => boolean)[] = [
		(logical) => sameCity(logical) && sameFeatures(logical),
		sameCity,
		(logical) => sameCountry(logical) && sameFeatures(logical),
		sameCountry,
	];

	for (const tier of tiers) {
		const best = getBestLogical(candidates.filter(tier), userContext);

		if (best) {
			return best;
		}
	}

	return undefined;
};
