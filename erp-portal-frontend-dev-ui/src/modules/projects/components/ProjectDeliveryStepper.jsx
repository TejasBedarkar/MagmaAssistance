import React from "react";
import {
  HiOutlineDocumentText,
  HiOutlineShieldCheck,
  HiOutlineFlag,
  HiOutlineClipboardDocumentList,
} from "react-icons/hi2";
import { StatusPill } from "../../../common/components/StatusPill.jsx";

const STEPS = [
  { id: "program", label: "Program", short: "1", Icon: HiOutlineDocumentText },
  { id: "approval", label: "Approval", short: "2", Icon: HiOutlineShieldCheck },
  { id: "milestones", label: "Milestones", short: "3", Icon: HiOutlineFlag },
  { id: "tasks", label: "Tasks", short: "4", Icon: HiOutlineClipboardDocumentList },
];

function normalizeStatus(status) {
  return String(status || "Draft").trim();
}

/** Derive step states for the program delivery stepper. */
export function getDeliveryStepStates({ status, milestoneCount, taskCount, isNew }) {
  const s = normalizeStatus(status);
  const isActive = s === "Active";
  const isPending = s === "Pending Approval";
  const isRejected = s === "Rejected";
  const isDraft = s === "Draft" || isNew;
  const pastApproval = isActive || s === "On Hold" || s === "Completed";

  const program = isNew ? "active" : "done";
  let approval = "upcoming";
  if (pastApproval) approval = "done";
  else if (isPending) approval = "active";
  else if (isRejected) approval = "warn";
  else if (isDraft && !isNew) approval = "active";

  let milestones = "locked";
  if (isActive) {
    milestones = milestoneCount > 0 ? "done" : "active";
  } else if (pastApproval && !isActive) {
    milestones = "locked";
  }

  let tasks = "locked";
  if (isActive && milestoneCount > 0) {
    tasks = taskCount > 0 ? "done" : "active";
  } else if (isActive && milestoneCount === 0) {
    tasks = "locked";
  }

  return { program, approval, milestones, tasks, isActive, isPending, isRejected };
}

export default function ProjectDeliveryStepper({ status, milestoneCount, taskCount, isNew }) {
  const states = getDeliveryStepStates({ status, milestoneCount, taskCount, isNew });
  const stateMap = {
    program: states.program,
    approval: states.approval,
    milestones: states.milestones,
    tasks: states.tasks,
  };

  return (
    <nav className="pm-delivery-stepper" aria-label="Program delivery progress">
      <ol className="pm-delivery-stepper__list">
        {STEPS.map((step, index) => {
          const state = stateMap[step.id] || "upcoming";
          const Icon = step.Icon;
          return (
            <li
              key={step.id}
              className={`pm-delivery-stepper__step pm-delivery-stepper__step--${state}`}
            >
              <div className="pm-delivery-stepper__node" aria-current={state === "active" ? "step" : undefined}>
                <span className="pm-delivery-stepper__icon-wrap">
                  <Icon className="pm-delivery-stepper__icon" aria-hidden />
                </span>
                <span className="pm-delivery-stepper__label">{step.label}</span>
              </div>
              {index < STEPS.length - 1 ? (
                <span className={`pm-delivery-stepper__connector pm-delivery-stepper__connector--${state}`} aria-hidden />
              ) : null}
            </li>
          );
        })}
      </ol>
      <div className="pm-delivery-stepper__status-row">
        <span className="pm-delivery-stepper__status-label">Current status</span>
        <StatusPill
          tone={
            states.isActive
              ? "success"
              : states.isPending
                ? "warn"
                : states.isRejected
                  ? "danger"
                  : "default"
          }
        >
          {normalizeStatus(status) || "Draft"}
        </StatusPill>
      </div>
    </nav>
  );
}
