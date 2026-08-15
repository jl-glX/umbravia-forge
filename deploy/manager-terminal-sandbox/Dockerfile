FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    bash \
    coreutils \
    diffutils \
    file \
    findutils \
    gawk \
    git \
    grep \
    jq \
    less \
    nano \
    openssh-client \
    procps \
    python3 \
    samba-common-bin \
    sed \
    smbclient \
    tar \
    unzip \
    zip \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 10001 umbravia-terminal \
  && useradd --uid 10001 --gid 10001 --create-home --shell /bin/bash umbravia-terminal \
  && mkdir -p /workspace \
  && chown 10001:10001 /workspace

USER 10001:10001
WORKDIR /workspace

CMD ["tail", "-f", "/dev/null"]
