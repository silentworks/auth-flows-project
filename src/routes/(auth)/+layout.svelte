<script lang="ts">
	import { page } from '$app/stores';
	import Alert from '$lib/Alert.svelte';
	import { getFlash } from 'sveltekit-flash-message/client';

	const flash = getFlash(page);
</script>

<svelte:head>
	<title>Auth Flows</title>
</svelte:head>

<main data-theme="winter">
	<div class="flex flex-col h-screen">
		<div class="header border-b border-gray-300 py-8 px-4 mx-8 text-center">
			<h1 class="font-semibold">
				<a href="/auth">Auth Flows</a>
			</h1>
		</div>
		<div class="grid place-items-center my-20 mx-2 sm:my-auto">
			<div
				class="w-11/12 p-12 px-6 py-10 rounded-lg sm:w-8/12 md:w-6/12 lg:w-5/12 2xl:w-3/12 sm:px-10 sm:py-6"
			>
				{#if $flash}
					<Alert class="{$flash.type == 'success' ? 'alert-info' : 'alert-error'} mb-10"
						>{$flash.message}</Alert
					>
				{/if}
				<slot />
			</div>
		</div>
	</div>
</main>
