# =============================================================================
# main.tf — EventBridge -> SQS -> Lambda Gmail sync pipeline
# =============================================================================
#
# This module creates the Stage 2 Session C plumbing only. The worker refreshes
# the user's Gmail access token to prove OAuth/KMS connectivity, then calls the
# sync-core stub classifier that writes one synthetic application row. Real
# Gmail fetching, classification, and LLM extraction are intentionally deferred.
# =============================================================================

locals {
  name_prefix = "${var.project}-${var.environment}"
}

data "aws_region" "current" {}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = ["sts:AssumeRole"]
  }
}

# -----------------------------------------------------------------------------
# SQS — sync job queue + DLQ
# -----------------------------------------------------------------------------

resource "aws_sqs_queue" "dlq" {
  name                      = "${local.name_prefix}-sync-jobs-dlq"
  message_retention_seconds = 1209600 # 14 days

  tags = {
    Name      = "${local.name_prefix}-sync-jobs-dlq"
    Component = "sync"
  }
}

resource "aws_sqs_queue" "jobs" {
  name                       = "${local.name_prefix}-sync-jobs"
  visibility_timeout_seconds = 300    # 5 min; comfortably above worker timeout.
  message_retention_seconds  = 345600 # 4 days

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Name      = "${local.name_prefix}-sync-jobs"
    Component = "sync"
  }
}

# -----------------------------------------------------------------------------
# Scheduler Lambda — EventBridge target that enqueues one message per due user
# -----------------------------------------------------------------------------

resource "aws_iam_role" "scheduler" {
  name               = "${local.name_prefix}-sync-scheduler"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role_policy_attachment" "scheduler_basic_execution" {
  role       = aws_iam_role.scheduler.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "scheduler_dynamodb" {
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:Scan",
      "dynamodb:Query",
    ]
    resources = [
      var.users_table_arn,
      "${var.users_table_arn}/index/*",
    ]
  }

  statement {
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
    ]
    resources = [
      var.sync_state_table_arn,
    ]
  }
}

resource "aws_iam_role_policy" "scheduler_dynamodb" {
  name   = "${local.name_prefix}-sync-scheduler-dynamodb"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler_dynamodb.json
}

data "aws_iam_policy_document" "scheduler_sqs" {
  statement {
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.jobs.arn]
  }
}

resource "aws_iam_role_policy" "scheduler_sqs" {
  name   = "${local.name_prefix}-sync-scheduler-sqs"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler_sqs.json
}

resource "aws_lambda_function" "scheduler" {
  function_name = "${local.name_prefix}-sync-scheduler"
  role          = aws_iam_role.scheduler.arn

  filename         = var.scheduler_zip_path
  source_code_hash = filebase64sha256(var.scheduler_zip_path)

  runtime = var.lambda_runtime
  handler = "index.handler"

  memory_size = 256
  timeout     = 60

  environment {
    variables = {
      USERS_TABLE      = var.users_table_name
      SYNC_STATE_TABLE = var.sync_state_table_name
      JOBS_QUEUE_URL   = aws_sqs_queue.jobs.url
    }
  }

  tags = {
    Name      = "${local.name_prefix}-sync-scheduler"
    Component = "sync"
  }
}

resource "aws_cloudwatch_event_rule" "cron" {
  name                = "${local.name_prefix}-sync-cron"
  description         = "Run the ${local.name_prefix} Gmail sync scheduler every 15 minutes."
  schedule_expression = "rate(15 minutes)"

  tags = {
    Name      = "${local.name_prefix}-sync-cron"
    Component = "sync"
  }
}

resource "aws_cloudwatch_event_target" "scheduler" {
  rule      = aws_cloudwatch_event_rule.cron.name
  target_id = "sync-scheduler"
  arn       = aws_lambda_function.scheduler.arn
}

resource "aws_lambda_permission" "allow_eventbridge_scheduler" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.scheduler.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.cron.arn
}

# -----------------------------------------------------------------------------
# Worker Lambda — SQS consumer that refreshes Gmail and writes stub applications
# -----------------------------------------------------------------------------

resource "aws_iam_role" "worker" {
  name               = "${local.name_prefix}-sync-worker"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role_policy_attachment" "worker_basic_execution" {
  role       = aws_iam_role.worker.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

data "aws_iam_policy_document" "worker_dynamodb" {
  statement {
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
    ]
    resources = [
      var.users_table_arn,
    ]
  }

  statement {
    effect = "Allow"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
    ]
    resources = [
      var.applications_table_arn,
      "${var.applications_table_arn}/index/*",
    ]
  }

  statement {
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:UpdateItem",
    ]
    resources = [
      var.sync_state_table_arn,
    ]
  }
}

resource "aws_iam_role_policy" "worker_dynamodb" {
  name   = "${local.name_prefix}-sync-worker-dynamodb"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker_dynamodb.json
}

data "aws_iam_policy_document" "worker_kms_tokens" {
  statement {
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [var.token_kms_key_arn]

    condition {
      test     = "Null"
      variable = "kms:EncryptionContext:userId"
      values   = ["false"]
    }
  }
}

resource "aws_iam_role_policy" "worker_kms_tokens" {
  name   = "${local.name_prefix}-sync-worker-kms-tokens"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker_kms_tokens.json
}

data "aws_iam_policy_document" "worker_sqs" {
  statement {
    effect = "Allow"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
    ]
    resources = [aws_sqs_queue.jobs.arn]
  }
}

resource "aws_iam_role_policy" "worker_sqs" {
  name   = "${local.name_prefix}-sync-worker-sqs"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker_sqs.json
}

resource "aws_lambda_function" "worker" {
  function_name = "${local.name_prefix}-sync-worker"
  role          = aws_iam_role.worker.arn

  filename         = var.worker_zip_path
  source_code_hash = filebase64sha256(var.worker_zip_path)

  runtime = var.lambda_runtime
  handler = "index.handler"

  memory_size = 1024
  timeout     = 120

  environment {
    variables = {
      USERS_TABLE               = var.users_table_name
      APPLICATIONS_TABLE        = var.applications_table_name
      SYNC_STATE_TABLE          = var.sync_state_table_name
      TOKEN_KMS_KEY_ARN         = var.token_kms_key_arn
      GMAIL_OAUTH_CLIENT_ID     = var.gmail_oauth_client_id
      GMAIL_OAUTH_CLIENT_SECRET = var.gmail_oauth_client_secret
      JOBS_QUEUE_URL            = aws_sqs_queue.jobs.url
      STUB_CLASSIFIER           = "true"
    }
  }

  tags = {
    Name      = "${local.name_prefix}-sync-worker"
    Component = "sync"
  }
}

resource "aws_lambda_event_source_mapping" "worker_jobs" {
  event_source_arn = aws_sqs_queue.jobs.arn
  function_name    = aws_lambda_function.worker.arn
  batch_size       = 1
}
