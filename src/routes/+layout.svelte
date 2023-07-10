<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { onMount } from 'svelte';
	import { initFlash } from 'sveltekit-flash-message/client';
	import { page } from '$app/stores';

	export let data;

	const flash = initFlash(page);
	const flashTimeoutMs = 8000;

	let flashTimeout: ReturnType<typeof setTimeout>;
	$: if ($flash) {
		clearTimeout(flashTimeout);
		flashTimeout = setTimeout(() => ($flash = undefined), flashTimeoutMs);
	}

	$: ({ supabase, session } = data);

	onMount(() => {
		const {
			data: { subscription }
		} = supabase.auth.onAuthStateChange((_, _session) => {
			if (_session?.expires_at !== session?.expires_at) {
				invalidate('supabase:auth');
			}
		});

		return () => {
			subscription.unsubscribe();
		};
	});
</script>

<svelte:head>
	<title>Auth Flows</title>
</svelte:head>

<slot />
