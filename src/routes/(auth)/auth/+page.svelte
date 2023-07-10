<script>
	const authPages = [
		{
			url: '/auth/signup',
			title: 'Sign up with email/password'
		},
		{
			url: '/auth/magic-link',
			title: 'Sign up with magic link'
		},
		{
			url: '/auth/oauth',
			title: 'Sign up with OAuth'
		},
		{
			url: '/auth/forgotpassword',
			title: 'Password reset'
		},
		{
			url: '/auth/invite',
			title: 'Invite user by email'
		},
		{
			url: '/auth/generate-links',
			title: 'Examples using .generateLink'
		}
	];
</script>

<h2 class="font-semibold text-4xl mb-4">Auth Flows</h2>
<p class="font-medium mb-4">Please select a flow below to test out</p>
<ul
	class="mt-8 mx-auto max-w-xs text-left font-light text-lg leading-none border-blue-200 divide-y divide-blue-200"
>
	{#each authPages as page}
		<li>
			<a
				href={page.url}
				class="py-3.5 w-full flex items-center text-blue-500 hover:text-blue-700 hover:bg-blue-50"
			>
				<span class="ml-5 mr-2.5 w-1 h-7 bg-blue-500 rounded-r-md" />
				{page.title}</a
			>
		</li>
	{/each}
</ul>
