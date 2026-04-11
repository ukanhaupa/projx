Output .github/demo.gif

Set Shell "bash"
Set FontSize 16
Set Width 1200
Set Height 720
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set PlaybackSpeed 1.0
Set Padding 20

# Land on a clean prompt
Hide
Type "cd $(mktemp -d) && clear"
Enter
Sleep 500ms
Show

# The pitch
Type "# Scaffold a full-stack app in 30 seconds"
Sleep 800ms
Enter
Sleep 400ms

# The one-liner
Type "npx create-projx my-app --components fastify,frontend,e2e -y --no-install --no-git"
Sleep 600ms
Enter

# Let the CLI run
Sleep 5s

# Show what you got
Type "cd my-app && ls -la"
Enter
Sleep 4s

# The payoff
Type "# Backend + frontend + E2E tests + Docker + CI, all wired up."
Sleep 1500ms
Enter
Sleep 800ms

Type "# Run ./setup.sh and you're coding features, not boilerplate."
Sleep 2s
Enter
Sleep 1500ms
