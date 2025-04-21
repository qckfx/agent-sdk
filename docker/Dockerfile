# /docker/Dockerfile
FROM node:18-alpine

# Install essential tools for command execution, including xxd for binary operations
RUN apk add --no-cache bash curl git vim-common

# Set up a non-root user for better security
RUN addgroup -S agent && adduser -S agent -G agent
WORKDIR /app
RUN chown -R agent:agent /app

# Copy utility scripts - do this as root before switching to agent user
COPY scripts/binary-replace.sh /usr/local/bin/binary-replace.sh
COPY scripts/directory-mapper.sh /usr/local/bin/directory-mapper.sh
RUN chmod +x /usr/local/bin/binary-replace.sh && \
    chmod +x /usr/local/bin/directory-mapper.sh && \
    chown agent:agent /usr/local/bin/binary-replace.sh && \
    chown agent:agent /usr/local/bin/directory-mapper.sh

# Switch to non-root user
USER agent

# Set environment variables
ENV NODE_ENV=production
ENV PATH="/app/node_modules/.bin:/usr/local/bin:${PATH}"

# Use bash as the default shell
SHELL ["/bin/bash", "-c"]

# Configure git to trust workspace directory
RUN git config --global --add safe.directory /workspace

# Keep container running
CMD ["tail", "-f", "/dev/null"]