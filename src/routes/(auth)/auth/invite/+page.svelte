<script lang="ts">
	import { enhance } from '$app/forms';
	import Alert from '$lib/Alert.svelte';
	import InputErrorMessage from '$lib/InputErrorMessage.svelte';

	export let form;
</script>

{#if form?.message !== undefined}
	<Alert class="{form?.success ? 'alert-info' : 'alert-error'} mb-10">{form?.message}</Alert>
{/if}
<h2 class="font-semibold text-4xl mb-4">Invite a friend</h2>
<p class="font-medium mb-4">
	Hi, Maybe your friend would be interested in this app, why not send them an invite
</p>
<form class="" method="post" use:enhance>
	<div class="form-control">
		<label for="email" class="label">Email</label>
		<input
			id="email"
			name="email"
			type="text"
			value={form?.email ?? ''}
			class="input input-bordered"
		/>
	</div>
	{#if form?.errors?.email}
		<InputErrorMessage>{form?.errors?.email}</InputErrorMessage>
	{/if}
	<div class="form-control mt-6">
		<button class="btn btn-primary no-animation">Send invite</button>
	</div>
</form>
<div class="pt-4 text-center">
	Other <a href="/auth" class="underline text-blue-500">sign in options</a>
</div>
