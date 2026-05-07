variable "region" {
  description = "AWS region for the state backend resources."
  type        = string
  default     = "us-east-1"
}

variable "state_bucket_name" {
  description = "Name of the S3 bucket that will hold Terraform state for all environments. Must be globally unique."
  type        = string
  default     = "jobtracker-tfstate-209479264107"
}

variable "lock_table_name" {
  description = "Name of the DynamoDB table used by Terraform for state locking."
  type        = string
  default     = "jobtracker-tfstate-locks"
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default = {
    Project     = "jobtracker"
    ManagedBy   = "terraform"
    Component   = "tf-state-backend"
  }
}
