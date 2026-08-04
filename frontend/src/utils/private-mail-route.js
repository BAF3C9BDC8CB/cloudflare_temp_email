export const isPublicMailRoute = (path) =>
  /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?m\/[^/]+$/.test(path)
