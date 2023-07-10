<script lang="ts">
	import { page } from '$app/stores';
	import Azure from '$lib/icons/Azure.svelte';
	import GitHub from '$lib/icons/GitHub.svelte';
	import Google from '$lib/icons/Google.svelte';
	import Slack from '$lib/icons/Slack.svelte';
	import type { PageData } from './$types';

	export let data: PageData;

	$: ({ supabase } = data);
</script>

<h2 class="font-semibold text-4xl mb-4">Sign in</h2>
<p class="font-medium mb-4">Hi, Welcome back</p>
<div class="space-y-2">
	<form method="post">
		<input type="hidden" name="provider" value="github" />
		<button
			class="btn btn-outline border-gray-200 hover:bg-transparent hover:text-gray-500 gap-2 w-full normal-case no-animation"
		>
			<GitHub />
			Sign in with GitHub
		</button>
	</form>
	<form method="post">
		<input type="hidden" name="provider" value="slack" />
		<button
			class="btn btn-outline border-gray-200 hover:bg-transparent hover:text-gray-500 gap-2 w-full normal-case no-animation"
		>
			<Slack />
			Sign in with Slack
		</button>
	</form>
	<form method="post">
		<input type="hidden" name="provider" value="google" />
		<button
			class="btn btn-outline border-gray-200 hover:bg-transparent hover:text-gray-500 gap-2 w-full normal-case no-animation"
		>
			<Google />
			Sign in with Google
		</button>
	</form>
	<form method="post">
		<input type="hidden" name="provider" value="azure" />
		<button
			class="btn btn-outline border-gray-200 hover:bg-transparent hover:text-gray-500 gap-2 w-full normal-case no-animation"
		>
			<Azure />
			Sign in with Azure
		</button>
	</form>
	<div class="pt-4 text-center">
		Other <a href="/auth" class="underline text-blue-500">sign in options</a>
	</div>
</div>
