app = 'quietlink-app'  # Replace with your app name
primary_region = 'iad'  # Choose a region

[build]
  builder = 'paketobuildpacks/builder:base'
  buildpacks = ['gcr.io/paketo-buildpacks/nodejs']

[[services]]
  internal_port = 3000
  processes = ['app']

  [[services.ports]]
    handlers = ['http']
    port = 80

  [[services.ports]]
    handlers = ['tls', 'http']
    port = 443
