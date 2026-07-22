export class OperationCancelledError extends Error {
  constructor(message = 'Operation cancelled') {
    super(message)
    this.name = 'OperationCancelledError'
  }
}
