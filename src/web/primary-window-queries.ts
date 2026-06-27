import { QueryClient } from '@tanstack/react-query'
export const primaryWindowQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
})
