// src/routes/+layout.server.ts
import { loadFlashMessage } from 'sveltekit-flash-message/server';

export const load = loadFlashMessage(async ({ locals: { getSession } }) => {
	return {
		session: await getSession()
	};
});
